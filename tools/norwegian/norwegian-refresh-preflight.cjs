'use strict';
// Local-only candidate validation. No Google service, network or publishing.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {instantSerial}=require('./norwegian-records-to-import.cjs');
const base=__dirname,DAY=86400000;
const coreText=fs.readFileSync(path.join(base,'itinerary-core.js'),'utf8');
const feedText=fs.readFileSync(path.join(base,'norwegian-feed.gs'),'utf8');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const TRANSPORT_RECORD_FIELDS=['lookup_key','cruise_line','ship','sail_date','return_date','nights','itinerary','departure_port','visiting_ports','day_plan','source_checked_at','feed_complete','booking_url','source','itinerary_code','package_id','events_url'];
function buildTransport(source){
 return {...source,records:source.records.map(record=>Object.fromEntries(TRANSPORT_RECORD_FIELDS.map(key=>{
  if(record[key]===undefined)throw Error('TRANSPORT_FIELD_MISSING_'+key);return [key,record[key]];
 })))};
}
function iso(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('INVALID_CALENDAR_DATE');
 return value;
}
function official(url){const u=new URL(url);if(u.protocol!=='https:'||!(u.hostname==='ncl.com'||u.hostname.endsWith('.ncl.com'))||u.username||u.password||[...u.searchParams.keys()].some(k=>/key|token|secret|email|phone/i.test(k)))throw Error('NONPUBLIC_OR_UNOFFICIAL_SOURCE_URL');return u;}
function environment(){
 const c=vm.createContext({Date,Intl,console:{log(){}}});
 for(const name of ['SpreadsheetApp','PropertiesService','UrlFetchApp','ScriptApp','DriveApp','LockService','Utilities','Logger'])c[name]=new Proxy({}, {get(){throw Error('PREFLIGHT_FORBIDS_EXTERNAL_SERVICES');}});
 vm.runInContext(coreText+'\n'+feedText,c,{timeout:5000});return c;
}
function preflight(source,window,options={}){
 const start=iso(window.start),end=iso(window.end_exclusive),through=new Date(Date.parse(end+'T00:00:00Z')-DAY).toISOString().slice(0,10);
 if(end<=start)throw Error('INVALID_WINDOW');
 if(source.source_fetch_complete!==true||!Array.isArray(source.failures)||source.failures.length)throw Error('SOURCE_COLLECTION_INCOMPLETE');
 if(source.window_start!==start||source.window_end_inclusive!==through)throw Error('SOURCE_WINDOW_MISMATCH');
 if(source.source_origin!=='https://www.ncl.com'||!['source_inventory_total','unique_cruise_routes','package_candidates'].every(k=>Number.isInteger(source[k])&&source[k]>0))throw Error('SOURCE_COLLECTION_METADATA_INVALID');
 const records=source.records;
 if(!Array.isArray(records)||!records.length||source.record_count!==records.length)throw Error('SOURCE_COUNT_INCONSISTENT');
 if(records.length>6000)throw Error('NCL_ALONE_EXCEEDS_MASTER_CAPACITY');
 const checked=String(source.checked_at||'');instantSerial(checked);
 const allowed=new Set(['lookup_key','cruise_line','ship','sail_date','return_date','nights','itinerary','departure_port','visiting_ports','day_plan','display_day_plan','source_checked_at','feed_complete','booking_url','events_url','source','itinerary_code','package_id','sail_id','source_sailings_url','source_urls','review_reasons','events']);
 const eventAllowed=new Set(['eventOrder','date','relativeCalendarDay','cruisingDay','event','title','portCode','isTender','isEmbarkation','isDisembarkation','isIdlCrossing']);
 const c=environment(),seen=new Map(),normalized=[],lineage=new Set();
 for(const r of records){
  for(const key of Object.keys(r))if(!allowed.has(key))throw Error('UNEXPECTED_RECORD_FIELD_'+key);
  if(r.cruise_line!=='Norwegian'||typeof r.ship!=='string'||!r.ship||typeof r.feed_complete!=='boolean'||!Array.isArray(r.events))throw Error('SOURCE_RECORD_SCHEMA_MISMATCH');
  iso(r.sail_date);iso(r.return_date);instantSerial(r.source_checked_at);
  if(r.sail_date<start||r.sail_date>=end||r.return_date<=r.sail_date)throw Error('SOURCE_RECORD_OUTSIDE_WINDOW_OR_REVERSED');
  if(!Number.isInteger(r.nights)||r.nights!==(Date.parse(r.return_date+'T00:00:00Z')-Date.parse(r.sail_date+'T00:00:00Z'))/DAY)throw Error('SOURCE_DURATION_MISMATCH');
  for(const event of r.events)for(const key of Object.keys(event))if(!eventAllowed.has(key))throw Error('UNEXPECTED_EVENT_FIELD_'+key);
  const human=official(r.booking_url),events=official(r.events_url);official(r.source_sailings_url);
  if(human.pathname!=='/vacation-builder'||human.searchParams.get('itineraryCode')!==r.itinerary_code||human.searchParams.get('packageId')!==String(r.package_id))throw Error('DATED_HUMAN_SOURCE_IDENTITY_MISMATCH');
  if(events.pathname!=='/api/vacations/events/'+r.itinerary_code+'/package/'+r.package_id)throw Error('DATED_EVENTS_SOURCE_IDENTITY_MISMATCH');
  if(!Array.isArray(r.source_urls)||!r.source_urls.length)throw Error('SOURCE_LINEAGE_MISSING');r.source_urls.forEach(url=>{official(url);lineage.add(url);});
  if(!r.source_urls.includes(r.events_url))throw Error('PRIMARY_EVENTS_SOURCE_MISSING_FROM_LINEAGE');
  const n=c.normalizeBooking({ship:r.ship,line:'Norwegian',sail_date:r.sail_date,return_date:r.return_date});
  if(!n.ready||n.lookup_key!==r.lookup_key)throw Error('SOURCE_KEY_MISMATCH');
  const mapped=c.norwegianRecord_({code:r.itinerary_code,ship:r.ship,title:r.itinerary,departure_port:r.departure_port,visiting_ports:r.visiting_ports},
   {code:r.itinerary_code,packageId:String(r.package_id),start:r.sail_date,end:r.return_date},
   {itineraryCode:r.itinerary_code,packageId:r.package_id,events:r.events},r.source_checked_at,r.booking_url);
  if(mapped.lookup_key!==r.lookup_key||mapped.day_plan!==r.day_plan)throw Error('CANONICAL_MACHINE_PLAN_DISAGREES_WITH_RAW_EVENTS');
  const display=c.itineraryNclDisplayPlan(mapped.day_plan,r.sail_date);
  if(r.display_day_plan!==display)throw Error('CANONICAL_HUMAN_PLAN_DISAGREES_WITH_SHARED_FORMATTER');
  // Never waive an extractor hold even if the shared mapper finds fewer issues.
  mapped.feed_complete=r.feed_complete&&mapped.feed_complete;
  normalized.push(mapped);seen.set(r.lookup_key,(seen.get(r.lookup_key)||0)+1);
 }
 if(lineage.size!==source.package_candidates)throw Error('DISCOVERED_PACKAGES_NOT_FULLY_ACCOUNTED_FOR');
 const validation={records:records.length,unique_keys:seen.size,duplicate_groups:[...seen.values()].filter(n=>n>1).length,
  duplicate_rows:[...seen.values()].filter(n=>n>1).reduce((a,b)=>a+b,0),ready_rows:0,held_rows:0,
  source_complete_rows:normalized.filter(r=>r.feed_complete).length,source_review_rows:normalized.filter(r=>!r.feed_complete).length,held_reasons:{},held_sailings:[]};
 normalized.forEach(r=>{
  const count=(r.day_plan.match(/^DAY \d+:/gm)||[]).length,matches=seen.get(r.lookup_key),status=matches>1?'REVIEW DUPLICATE LOOKUP':!r.feed_complete?'REVIEW SOURCE FEED':count!==r.nights+1?'REVIEW DAY PLAN':'DAY COUNT OK - VERIFY SOURCE';
  const result=c.validateItinerary({booking_ready:true,lookup_found:true,booking_lookup_key:r.lookup_key,lookup_key:r.lookup_key,
   booking_cruise_line:'Norwegian',cruise_line:'Norwegian',booking_ship:r.ship,ship:r.ship,
   booking_sail_date:r.sail_date,sail_date:r.sail_date,booking_return_date:r.return_date,return_date:r.return_date,booking_nights:r.nights,nights:r.nights,
   lookup_matches:matches,feed_complete:r.feed_complete,use_status:status,day_count_check:count===r.nights+1?'COUNT MATCHES':'DAY COUNT MISMATCH',
   expected_days:r.nights+1,listed_days:count,source:r.source,source_checked_at:r.source_checked_at,booking_url:r.booking_url,day_plan:r.day_plan});
  if(result.ready)validation.ready_rows++;
  else {validation.held_rows++;validation.held_sailings.push({lookup_key:r.lookup_key,return_date:r.return_date,reasons:Array.from(result.review_reasons||[])});for(const reason of result.review_reasons||[])validation.held_reasons[reason]=(validation.held_reasons[reason]||0)+1;}
 });
 if(validation.ready_rows+validation.held_rows!==records.length)throw Error('VALIDATION_COUNT_MISMATCH');
 const retrieved=new Date(options.retrievedAt||new Date());if(!Number.isFinite(retrieved.getTime()))throw Error('INVALID_RETRIEVAL_TIME');
 const rawRows=c.norwegianRows_(normalized,retrieved);
 const rows=rawRows.map(row=>Array.from(row,(cell,index)=>index===18||index===21?instantSerial(cell.toISOString()):cell));
 const headers=Array.from(vm.runInContext('NORWEGIAN_FEED_CONFIG.headers',c));
 for(const row of rows){
  if(row.length!==26||!row.slice(9,17).every(v=>v==='')||typeof row[20]!=='boolean'||row.some(v=>typeof v==='string'&&v.length>50000))throw Error('NORMALIZED_ROWS_SCHEMA_MISMATCH');
  if(![row[0],row[1],row[18],row[21]].every(Number.isFinite))throw Error('NORMALIZED_DATE_SERIAL_MISMATCH');
 }
 const other=options.otherSourceRows,capacity={master_capacity:6000,other_source_rows:Number.isInteger(other)?other:null,verified:Number.isInteger(other),total_rows:Number.isInteger(other)?other+records.length:null};
 if(capacity.verified&&(other<0||capacity.total_rows>6000))throw Error('MASTER_CAPACITY_EXCEEDED');
 const coverage={start,end_exclusive:end,end_inclusive:through};
 const artifact={headers,rows,row_count:rows.length,source_fetch_complete:true,checked_at:checked,spreadsheet_time_zone:'America/New_York',coverage,validation};
 const proof={preflight_passed:true,cloud_writes_performed:false,promotion_performed:false,public_schedule_fields_only:true,
  source_fetch_complete:true,checked_at:checked,coverage,validation,capacity,
  hashes:{core_sha256:hash(coreText),feed_sha256:hash(feedText),row_identity_order_sha256:hash(JSON.stringify(records.map(r=>[r.lookup_key,r.return_date,r.itinerary_code,r.package_id]))),normalized_rows_sha256:hash(JSON.stringify(rows))}};
 return {artifact,proof};
}
module.exports={preflight,environment,buildTransport,TRANSPORT_RECORD_FIELDS};
if(require.main===module){
 const args=process.argv.slice(2),arg=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
 const input=arg('--input'),out=arg('--outdir');if(!input||!out)throw Error('Expected --input and --outdir');
 try {
  const text=fs.readFileSync(input,'utf8'),source=JSON.parse(text.replace(/^\uFEFF/,''));
  const result=preflight(source,{start:arg('--start'),end_exclusive:arg('--end-exclusive')},{otherSourceRows:arg('--other-source-rows')===undefined?undefined:Number(arg('--other-source-rows'))});
  result.proof.hashes.source_snapshot_sha256=hash(Buffer.from(text));
  const transportText=JSON.stringify(buildTransport(source));
  result.proof.hashes.transport_snapshot_sha256=hash(Buffer.from(transportText));
  result.proof.transport={file_name:'drive-snapshot.json',format:'compact canonical NCL_EVENTS_V1',bytes:Buffer.byteLength(transportText),records:source.records.length,record_fields:TRANSPORT_RECORD_FIELDS};
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'drive-snapshot.json'),transportText);
  fs.writeFileSync(path.join(out,'normalized-rows.json'),JSON.stringify(result.artifact,null,2));
  fs.writeFileSync(path.join(out,'refresh-proof.json'),JSON.stringify(result.proof,null,2));
  const v=result.artifact.validation;
  console.log(JSON.stringify({candidate_directory:path.resolve(out),preflight_passed:true,records:v.records,unique_keys:v.unique_keys,duplicate_groups:v.duplicate_groups,ready_rows:v.ready_rows,held_rows:v.held_rows,source_complete_rows:v.source_complete_rows,source_review_rows:v.source_review_rows,capacity:result.proof.capacity}));
 } catch(error){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'refresh-proof.json'),JSON.stringify({preflight_passed:false,cloud_writes_performed:false,promotion_performed:false,error:String(error.message)},null,2));console.error('Preflight failed: '+error.message);process.exitCode=2;}
}
