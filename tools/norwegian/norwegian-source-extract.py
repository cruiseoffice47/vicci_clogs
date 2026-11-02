"""Anonymous, read-only extraction from the exact APIs used by ncl.com.
No pricing/customer fields are retained. No cloud or booking writes occur.
"""
import argparse, concurrent.futures as cf, datetime as dt, hashlib, json, re, subprocess, threading, time
from email.utils import parsedate_to_datetime
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASE='https://www.ncl.com'
CODE_ROOT=Path(__file__).resolve().parent
ROOT=CODE_ROOT
CACHE=ROOT/'norwegian-source-cache'
CACHE.mkdir(exist_ok=True)
ACCESS_STOPPED=threading.Event()
DIAGNOSTIC_LOCK=threading.Lock()
DIAGNOSTIC_COUNT=0

class SourceStageError(RuntimeError):
    def __init__(self,stage,url,cause):
        self.stage,self.url,self.cause=stage,url,cause
        super().__init__(type(cause).__name__+': '+str(cause)[:240])

def error_details(error):
    cause=error.cause if isinstance(error,SourceStageError) else error
    return {'error_stage':getattr(error,'stage','source_collection'),
      'error_class':type(cause).__name__,'http_status':getattr(cause,'code',None),
      'reason':re.sub(r'[\r\n]+',' ',str(cause))[:240]}

def diagnostic(details):
    global DIAGNOSTIC_COUNT
    with DIAGNOSTIC_LOCK:
        if DIAGNOSTIC_COUNT<12:
            print('SOURCE_DIAGNOSTIC '+json.dumps(details,ensure_ascii=True),flush=True)
        DIAGNOSTIC_COUNT+=1

def retry_seconds(value,attempt):
    text=str(value or '').strip()
    if re.fullmatch(r'\d+(?:\.\d+)?',text):return float(text)
    try:
        when=parsedate_to_datetime(text)
        if when.tzinfo is None:when=when.replace(tzinfo=dt.timezone.utc)
        return max(0,(when-dt.datetime.now(dt.timezone.utc)).total_seconds())
    except (ValueError,TypeError,OverflowError):return 2*(attempt+1)

def fetch(url):
    for attempt in range(4):
        if ACCESS_STOPPED.is_set():raise RuntimeError('SOURCE_COLLECTION_ABORTED_AFTER_TERMINAL_ERROR')
        try:
            req=Request(url,headers={'Accept':'application/json','User-Agent':'CruiseItinerarySourceCheck/1.0'})
            with urlopen(req,timeout=70) as res:
                if res.status != 200: raise RuntimeError('HTTP '+str(res.status))
                return json.load(res)
        except HTTPError as e:
            if e.code==403:
                ACCESS_STOPPED.set()
                diagnostic({'error_stage':'http_fetch','http_status':403,'error_class':'HTTPError','source_url':url,'action':'abort_collection_no_bypass'})
                raise
            if e.code not in (429,500,502,503,504) or attempt==3: raise
            delay=retry_seconds(e.headers.get('Retry-After'),attempt)
            diagnostic({'error_stage':'http_fetch','http_status':e.code,'error_class':'HTTPError','source_url':url,'attempt':attempt+1,'retry_after_seconds':delay})
            if delay>300:raise RuntimeError('SOURCE_RETRY_AFTER_EXCEEDS_JOB_BUDGET') from e
            time.sleep(delay)
        except Exception:
            if attempt==3: raise
            time.sleep(attempt+1)

def save(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')

def add_display_day_plans(records):
    """Use the production core's human formatter; leave source/quality untouched."""
    inputs=[{'day_plan':r['day_plan'],'sail_date':r['sail_date']} for r in records]
    process=subprocess.run(['node',str(CODE_ROOT/'norwegian-source-display.cjs')],
      input=json.dumps(inputs,ensure_ascii=False),text=True,encoding='utf-8',
      capture_output=True,check=True)
    displays=json.loads(process.stdout)
    if not isinstance(displays,list) or len(displays)!=len(records) or any(not isinstance(v,str) for v in displays):
        raise RuntimeError('SHARED_DISPLAY_FORMATTER_CONTRACT_MISMATCH')
    return [dict(r,display_day_plan=display) for r,display in zip(records,displays)]

def iso(value):
    value=str(value or '')[:10]
    try: return dt.date.fromisoformat(value).isoformat()
    except ValueError: return ''

def months_between(start,end):
    d=dt.date.fromisoformat(start).replace(day=1); last=dt.date.fromisoformat(end).replace(day=1); out=[]
    while d<=last:
        out.append(d.strftime('%b-%Y'))
        d=(d.replace(day=28)+dt.timedelta(days=4)).replace(day=1)
    return ','.join(out)

def clock(value):
    match=re.fullmatch(r'\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::\d{2})?',str(value or ''))
    if not match: return ''
    hour,minute=map(int,match.groups())
    if hour>23 or minute>59: return ''
    return f'{hour%12 or 12}:{minute:02d} '+('PM' if hour>=12 else 'AM')

EVENT_KEYS=['eventOrder','date','relativeCalendarDay','cruisingDay','event','title','portCode','isTender','isEmbarkation','isDisembarkation','isIdlCrossing']
SAILING_KEYS=['packageId','sailId','sailingEventSequence','sailStartDate','sailEndDate','isFlyCruise','isPackage']
PLAN_EVENT_KEYS=['event','date','title','portCode','isEmbarkation','isDisembarkation','isIdlCrossing','eventOrder']

def record(itinerary,sailing,payload,checked_at,url,error=''):
    start,end=iso(sailing.get('sailStartDate')),iso(sailing.get('sailEndDate'))
    nights=(dt.date.fromisoformat(end)-dt.date.fromisoformat(start)).days if start and end else 0
    ship=itinerary.get('ship',{}).get('title','')
    events=[{k:e.get(k) for k in EVENT_KEYS} for e in payload.get('events',[])]
    issues=[error] if error else []
    if payload.get('itineraryCode')!=itinerary['code']: issues.append('ITINERARY_CODE_MISMATCH')
    if str(payload.get('packageId'))!=str(sailing['packageId']): issues.append('PACKAGE_ID_MISMATCH')
    groups=defaultdict(list)
    for event in events:
        day=event.get('relativeCalendarDay')
        if not isinstance(day,int) or day<1: issues.append('INVALID_RELATIVE_DAY'); continue
        groups[day].append(event)
        expected=(dt.date.fromisoformat(start)+dt.timedelta(days=day-1)).isoformat()
        if iso(event.get('date'))!=expected: issues.append('CALENDAR_DATE_MISMATCH')
        if event.get('isIdlCrossing'): issues.append('DATE_LINE_REQUIRES_REVIEW')
        if event.get('event') not in ('ARRIVAL','DEPARTURE','AT_SEA','SCENIC'): issues.append('UNKNOWN_SOURCE_EVENT')
        if event.get('event') in ('ARRIVAL','DEPARTURE','SCENIC') and (not event.get('title') or not clock(event.get('date'))):
            issues.append('MISSING_EVENT_TITLE_OR_CLOCK')
    plans=[]
    for day in range(1,nights+2):
        es=sorted(groups.get(day,[]),key=lambda e:e.get('eventOrder') or 0)
        if not es: issues.append('MISSING_SOURCE_DAY'); continue
        # One DAY marker per source calendar day; exact event objects preserve
        # all visits/scenic timestamps. Consumer validates/pairs the whole plan.
        parts=[{key:e.get(key) for key in PLAN_EVENT_KEYS} for e in es]
        plans.append(f'DAY {day}: NCL EVENTS '+json.dumps(parts,ensure_ascii=False,separators=(',',':')))
    # Conservative source sequence check, distinct from consumer validation.
    # Full overnight port days are explicit SCENIC records while a same-port
    # ARRIVAL remains open; never turn that placeholder into a new clock/port.
    open_port=None
    for event in sorted(events,key=lambda e:e.get('eventOrder') or 0):
        kind=event.get('event'); port=event.get('portCode')
        day=event.get('relativeCalendarDay')
        if kind=='ARRIVAL':
            if event.get('isDisembarkation') and day==nights+1:
                # NCL can publish an actual arrival the prior day and a final
                # same-port ARRIVAL marked disembarkation. Retain both source
                # events; the consumer labels the final clock disembarkation.
                if open_port is not None and open_port!=port: issues.append('AMBIGUOUS_PORT_SEQUENCE')
                open_port=None
            else:
                if open_port is not None: issues.append('AMBIGUOUS_PORT_SEQUENCE')
                open_port=port
        elif kind=='DEPARTURE':
            if event.get('isEmbarkation') and day==1 and open_port is None: continue
            if not port or open_port!=port: issues.append('AMBIGUOUS_PORT_SEQUENCE')
            open_port=None
        elif kind=='AT_SEA' and open_port is not None:
            issues.append('AMBIGUOUS_OVERNIGHT_SEA_DAY')
        elif kind=='SCENIC' and open_port is not None and port!=open_port:
            issues.append('AMBIGUOUS_SCENIC_WHILE_IN_PORT')
    if open_port is not None: issues.append('UNFINISHED_PORT_CALL')
    if any(day>nights+1 for day in groups): issues.append('EVENT_OUTSIDE_SAILING')
    if not start or not end or nights<1: issues.append('INVALID_SAILING_DATES')
    if not events: issues.append('NO_SOURCE_EVENTS')
    return {'lookup_key':'NORWEGIAN|'+re.sub(r'[ .-]','',ship.strip()).upper()+'|'+start,
      'cruise_line':'Norwegian','ship':ship,'sail_date':start,'return_date':end,'nights':nights,
      'itinerary':itinerary.get('title',''),'departure_port':itinerary.get('embarkationPort',{}).get('title',''),
      'visiting_ports':', '.join(p.get('title','') for p in itinerary.get('portsOfCall',[])),
      'day_plan':'\n'.join(plans),'source_checked_at':checked_at,'feed_complete':not issues,
      'booking_url':BASE+'/vacation-builder?'+urlencode({'itineraryCode':itinerary['code'],'packageId':str(sailing['packageId'])}),
      'events_url':url,'source':'Norwegian official live itinerary events',
      'itinerary_code':itinerary['code'],'package_id':str(sailing['packageId']),'sail_id':str(sailing.get('sailId','')),
      'source_sailings_url':BASE+'/api/vacations/sailings/'+quote(itinerary['code'],safe=''),
      'source_urls':[url],'review_reasons':sorted(set(issues)),'events':events}

def reformat_existing_record(existing):
    """Rebuild only presentation/quality fields from already verified raw events."""
    itinerary={'code':existing['itinerary_code'],'title':existing['itinerary'],
      'ship':{'title':existing['ship']},'embarkationPort':{'title':existing['departure_port']},'portsOfCall':[]}
    sailing={'packageId':existing['package_id'],'sailId':existing['sail_id'],
      'sailStartDate':existing['sail_date'],'sailEndDate':existing['return_date']}
    payload={'itineraryCode':existing['itinerary_code'],'packageId':existing['package_id'],'events':existing['events']}
    parsed=record(itinerary,sailing,payload,existing['source_checked_at'],existing.get('events_url') or existing['source_urls'][0])
    result=dict(existing)
    for key in ('day_plan','feed_complete','review_reasons'): result[key]=parsed[key]
    return result

def main():
    global ROOT,CACHE
    parser=argparse.ArgumentParser(); parser.add_argument('--start',default='2026-11-02');parser.add_argument('--end',default='2027-11-01');parser.add_argument('--workers',type=int,default=4);parser.add_argument('--reformat-existing',action='store_true');parser.add_argument('--add-display-existing',action='store_true');parser.add_argument('--output-dir');parser.add_argument('--cache-dir')
    args=parser.parse_args(); checked=dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z')
    if args.output_dir: ROOT=Path(args.output_dir).resolve();ROOT.mkdir(parents=True,exist_ok=True)
    if args.cache_dir: CACHE=Path(args.cache_dir).resolve()
    CACHE.mkdir(parents=True,exist_ok=True)
    if args.reformat_existing or args.add_display_existing:
        target=ROOT/'norwegian-source-records.json'; existing=json.loads(target.read_text(encoding='utf-8'))
        if args.reformat_existing:
            existing['records']=[reformat_existing_record(r) for r in existing['records']]
            existing['format_version']='NCL_EVENTS_V1'
        existing['records']=add_display_day_plans(existing['records'])
        temp=target.with_suffix('.json.tmp');save(temp,existing);temp.replace(target)
        print(json.dumps({'records':len(existing['records']),'feed_complete':sum(r['feed_complete'] for r in existing['records']),
          'review':sum(not r['feed_complete'] for r in existing['records']),'format_version':existing['format_version']}),flush=True)
        return
    dates=months_between(args.start,args.end); inventory=[]; failures=[]
    base=BASE+'/api/v2/vacations/search?'+urlencode({'limit':100,'offset':0,'dates':dates})
    first=fetch(base); total=first['total']; pages=[first]
    offsets=list(range(100,total,100))
    def search_page(offset): return fetch(BASE+'/api/v2/vacations/search?'+urlencode({'limit':100,'offset':offset,'dates':dates}))
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        pages.extend(pool.map(search_page,offsets))
    for page in pages: inventory.extend(page['itineraries'])
    routes={x['code']:x for x in inventory if x.get('bundleType')=='cruise'}
    if len(inventory)!=total: failures.append({'stage':'inventory','error':'PAGE_COUNT_MISMATCH','received':len(inventory),'total':total})
    inventory_fields=['code','packageId','title','ship','duration','embarkationPort','disembarkationPort','portsOfCall']
    save(CACHE/'inventory.json',[{k:r.get(k) for k in inventory_fields} for r in routes.values()])
    print(f'INVENTORY total={total} rows={len(inventory)} unique_cruise_routes={len(routes)}',flush=True)
    candidates=[]
    def sailings(itinerary):
        url=BASE+'/api/vacations/sailings/'+quote(itinerary['code'],safe='')+'?'+urlencode({'dates':dates})
        try: raw=fetch(url)
        except Exception as e:raise SourceStageError('sailings_fetch',url,e) from e
        unique={}
        for row in raw.get('pricingStateRooms',[]):
            start,end=iso(row.get('sailStartDate')),iso(row.get('sailEndDate'))
            if not(start and end and args.start<=start<=args.end) or row.get('isFlyCruise') or row.get('isPackage'): continue
            clean={k:row.get(k) for k in SAILING_KEYS}
            unique[(str(clean['packageId']),start,end)]=clean
        result=list(unique.values());save(CACHE/('sailings-'+itinerary['code']+'.json'),result)
        return [(itinerary,s) for s in result]
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs={pool.submit(sailings,r):r['code'] for r in routes.values()}
        for i,job in enumerate(cf.as_completed(jobs),1):
            try: candidates.extend(job.result())
            except Exception as e:
                failure={'stage':'sailings','code':jobs[job],**error_details(e)}
                failures.append(failure);diagnostic(failure)
                ACCESS_STOPPED.set()
                for pending in jobs:pending.cancel()
                break
            if i%25==0 or i==len(jobs): print(f'SAILINGS routes={i}/{len(jobs)} candidates={len(candidates)} errors={len(failures)}',flush=True)
    if failures:raise RuntimeError('SOURCE_SAILINGS_STAGE_FAILED_NO_PROMOTION')
    candidate_map={(r['code'],str(s['packageId']),iso(s['sailStartDate']),iso(s['sailEndDate'])):(r,s) for r,s in candidates}
    records=[]
    def detail(pair):
        route,sailing=pair; url=BASE+'/api/vacations/events/'+quote(route['code'],safe='')+'/package/'+quote(str(sailing['packageId']),safe='')
        try: raw=fetch(url)
        except Exception as e:raise SourceStageError('events_fetch',url,e) from e
        try:return record(route,sailing,raw,checked,url)
        except Exception as e:raise SourceStageError('events_parse',url,e) from e
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs={pool.submit(detail,pair):pair for pair in candidate_map.values()}
        for i,job in enumerate(cf.as_completed(jobs),1):
            try: records.append(job.result())
            except Exception as e:
                route,sailing=jobs[job]
                ship=route.get('ship');ship=ship.get('title','') if isinstance(ship,dict) else str(ship)[:100]
                failure={'stage':'events','ship':ship,'code':route['code'],'package_id':str(sailing['packageId']),**error_details(e)}
                failures.append(failure);diagnostic(failure)
                ACCESS_STOPPED.set()
                for pending in jobs:pending.cancel()
                break
            if i%50==0 or i==len(jobs): print(f'EVENTS sailings={i}/{len(jobs)} errors={len(failures)}',flush=True)
    # Collapse only EXACT identity+dates+published plan duplicates, keeping lineage.
    dedup={}
    for r in records:
        identity=(r['lookup_key'],r['return_date'],r['nights'],r['day_plan'],r['feed_complete'])
        if identity in dedup: dedup[identity]['source_urls']=sorted(set(dedup[identity]['source_urls']+r['source_urls']))
        else: dedup[identity]=r
    records=sorted(dedup.values(),key=lambda r:(r['ship'],r['sail_date'],r['return_date'],r['itinerary_code']))
    records=add_display_day_plans(records)
    counts=defaultdict(int)
    for r in records: counts[r['ship']]+=1
    output={'checked_at':checked,'format_version':'NCL_EVENTS_V1','source_origin':BASE,'search_source':base,'official_js_source':'https://cdn.ncl.com/packages/wcl/2.2.20/ncl-vacations-app/iife.js',
      'window_start':args.start,'window_end_inclusive':args.end,'time_basis':'Port-local date and time exactly as published by NCL, no timezone conversion',
      'source_fetch_complete':not failures,'source_inventory_total':total,'unique_cruise_routes':len(routes),'package_candidates':len(candidate_map),
      'record_count':len(records),'ship_counts':dict(sorted(counts.items())),'failures':failures,'records':records}
    save(ROOT/'norwegian-source-records.json',output)
    print('COMPLETE '+json.dumps({k:output[k] for k in ('source_fetch_complete','source_inventory_total','unique_cruise_routes','package_candidates','record_count','ship_counts')})+' failures='+str(len(failures)),flush=True)
    if failures: raise SystemExit(2)

if __name__=='__main__': main()
