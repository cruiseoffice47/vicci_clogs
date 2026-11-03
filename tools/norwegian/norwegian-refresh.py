"""Local public-schedule collector and preflight. Never publishes or sends messages.

collect: fresh ordinary anonymous NCL requests, isolated cache/output, then checks.
preflight: copies an existing public snapshot into isolated output; NO network.
Both leave the current verified snapshot/import artifacts untouched on failure.
"""
import argparse,calendar,datetime as dt,json,shutil,subprocess,sys,uuid
from pathlib import Path
from zoneinfo import ZoneInfo

CODE_ROOT=Path(__file__).resolve().parent
CANDIDATES=CODE_ROOT/'norwegian-refresh-next'
HORIZON_MONTHS=24

def rolling_window(as_of=None):
    today=dt.date.fromisoformat(as_of) if as_of else dt.datetime.now(ZoneInfo('America/New_York')).date()
    if HORIZON_MONTHS not in (12,24): raise ValueError("UNSUPPORTED_HORIZON_MONTHS")
    year=today.year+HORIZON_MONTHS//12
    end=dt.date(year,today.month,min(today.day,calendar.monthrange(year,today.month)[1]))
    return {'start':today.isoformat(),'end_exclusive':end.isoformat(),'end_inclusive':(end-dt.timedelta(days=1)).isoformat()}

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=['collect','preflight'])
    parser.add_argument('--source',type=Path,help='Required for offline preflight mode')
    parser.add_argument('--as-of',help='Explicit NY calendar date for reproducible historical preflight; omit for recurring collection')
    parser.add_argument('--workers',type=int,default=4,choices=range(1,5))
    parser.add_argument('--other-source-rows',type=int,help='Optional freshly counted rows from Carnival/Royal/MSC; recheck immediately before any later publication')
    args=parser.parse_args(argv)
    if args.mode=='preflight' and not args.source:parser.error('preflight requires --source')
    if args.mode=='collect' and args.source:parser.error('collect does not accept --source')
    window=rolling_window(args.as_of)
    run_id=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]
    run=CANDIDATES/run_id;run.mkdir(parents=True,exist_ok=False)
    candidate=run/'norwegian-source-records.json'
    status={'mode':args.mode,'started_at':dt.datetime.now(dt.timezone.utc).isoformat(),'window':window,'candidate_directory':str(run),'network_requested':args.mode=='collect','cloud_writes_performed':False,'promotion_performed':False,'passed':False}
    try:
        if args.mode=='preflight':
            original=args.source.resolve()
            if not original.is_file():raise RuntimeError('OFFLINE_SOURCE_NOT_FOUND')
            shutil.copyfile(original,candidate)
        else:
            # Only the isolated run directory/cache is supplied to the existing
            # collector; failed/partial discovery never overwrites live evidence.
            command=[sys.executable,str(CODE_ROOT/'norwegian-source-extract.py'),'--start',window['start'],'--end',window['end_inclusive'],'--workers',str(args.workers),'--output-dir',str(run),'--cache-dir',str(run/'cache')]
            if subprocess.run(command).returncode:raise RuntimeError('SOURCE_COLLECTION_FAILED_NO_PROMOTION')
        command=['node',str(CODE_ROOT/'norwegian-refresh-preflight.cjs'),'--input',str(candidate),'--outdir',str(run),'--start',window['start'],'--end-exclusive',window['end_exclusive']]
        if args.other_source_rows is not None:command+=['--other-source-rows',str(args.other_source_rows)]
        if subprocess.run(command).returncode:raise RuntimeError('PREFLIGHT_FAILED_NO_PROMOTION')
        status['passed']=True
        print(json.dumps({'passed':True,'candidate_directory':str(run),'transport_path':str(run/'drive-snapshot.json'),'rows_path':str(run/'normalized-rows.json'),'proof_path':str(run/'refresh-proof.json'),'window':window,'cloud_writes_performed':False}),flush=True)
    except Exception as error:
        status['error']=str(error)
        print(json.dumps({'passed':False,'candidate_directory':str(run),'error':str(error),'verified_snapshot_unchanged':True}),flush=True)
        return 2
    finally:
        status['finished_at']=dt.datetime.now(dt.timezone.utc).isoformat()
        (run/'run-status.json').write_text(json.dumps(status,indent=2),encoding='utf-8')
    return 0

if __name__=='__main__':raise SystemExit(main())
