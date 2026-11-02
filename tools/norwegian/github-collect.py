"""Hosted collector: public NCL facts only; never uses Google/customer secrets.

The GitHub workflow commits only the exact output file after this command exits
successfully. Collection/validation failure leaves the previous file untouched.
"""
import argparse,datetime as dt,hashlib,importlib.util,json,os,tempfile
from pathlib import Path
from zoneinfo import ZoneInfo

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('ncl_refresh',HERE/'norwegian-refresh.py')
refresh=importlib.util.module_from_spec(spec);spec.loader.exec_module(refresh)

def promote_candidate(candidate,output,offline=False):
    proof=json.loads((candidate/'refresh-proof.json').read_text(encoding='utf-8'))
    source=json.loads((candidate/'norwegian-source-records.json').read_text(encoding='utf-8'))
    payload=(candidate/'drive-snapshot.json').read_bytes()
    digest=hashlib.sha256(payload).hexdigest()
    if proof.get('preflight_passed') is not True or proof.get('hashes',{}).get('transport_snapshot_sha256')!=digest:
        raise RuntimeError('TRANSPORT_PROOF_BINDING_MISMATCH')
    if hashlib.sha256((candidate/'norwegian-source-records.json').read_bytes()).hexdigest()!=proof['hashes']['source_snapshot_sha256']:
        raise RuntimeError('SOURCE_PROOF_BINDING_MISMATCH')
    snapshot=json.loads(payload)
    if snapshot['source_fetch_complete'] is not True or snapshot['failures'] or snapshot['record_count']!=proof['validation']['records']:
        raise RuntimeError('PUBLIC_SNAPSHOT_COMPLETENESS_MISMATCH')
    checked=dt.datetime.fromisoformat(snapshot['checked_at'].replace('Z','+00:00'))
    if checked.tzinfo is None or checked.astimezone(ZoneInfo('America/New_York')).date().isoformat()!=snapshot['window_start']:
        raise RuntimeError('SNAPSHOT_CHECKED_DATE_WINDOW_MISMATCH')
    if not offline:
        now=dt.datetime.now(dt.timezone.utc)
        if not -dt.timedelta(minutes=10)<=now-checked<=dt.timedelta(hours=36):raise RuntimeError('SNAPSHOT_NOT_FRESH')
        if snapshot['window_start']!=now.astimezone(ZoneInfo('America/New_York')).date().isoformat():raise RuntimeError('SNAPSHOT_WINDOW_NOT_TODAY')
    output=output.resolve();output.parent.mkdir(parents=True,exist_ok=True)
    temporary=None
    try:
        with tempfile.NamedTemporaryFile(prefix='.norwegian-',suffix='.json.tmp',dir=output.parent,delete=False) as handle:
            temporary=Path(handle.name);handle.write(payload);handle.flush();os.fsync(handle.fileno())
        os.replace(temporary,output)
    finally:
        if temporary and temporary.exists():temporary.unlink()
    return {'output':str(output),'sha256':digest,'bytes':len(payload),'checked_at':snapshot['checked_at'],
      'records':snapshot['record_count'],'ready_rows':proof['validation']['ready_rows'],'held_rows':proof['validation']['held_rows'],
      'duplicate_groups':proof['validation']['duplicate_groups'],'ordinary_anonymous_requests':not offline,
      'customer_credentials_used':False,'offline_test':offline,'candidate_directory':str(candidate)}

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path('data/norwegian-sailings.json'))
    parser.add_argument('--offline-source',type=Path,help='Local QA only; the production workflow never sets this')
    parser.add_argument('--as-of',help='Local historical offline QA only')
    parser.add_argument('--workers',type=int,default=4,choices=range(1,5),help='Ordinary collection concurrency; reduce only when evidence warrants pacing')
    args=parser.parse_args(argv)
    if args.as_of and not args.offline_source:parser.error('--as-of requires offline QA source')
    run_temp=Path(os.environ.get('RUNNER_TEMP',str(HERE/'norwegian-refresh-next')))
    refresh.CANDIDATES=run_temp/'norwegian-candidate-runs'
    refresh.CANDIDATES.mkdir(parents=True,exist_ok=True)
    before={p for p in refresh.CANDIDATES.iterdir() if p.is_dir()}
    command=['collect','--workers',str(args.workers)]
    if args.offline_source:
        command=['preflight','--source',str(args.offline_source.resolve())]
        if args.as_of:command+=['--as-of',args.as_of]
    if refresh.main(command):return 2
    created={p for p in refresh.CANDIDATES.iterdir() if p.is_dir()}-before
    if len(created)!=1:raise RuntimeError('CANDIDATE_RUN_IDENTITY_AMBIGUOUS')
    result=promote_candidate(created.pop(),args.output,bool(args.offline_source))
    print(json.dumps({'local_output_promoted':True,**result}),flush=True)
    summary=os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary,'a',encoding='utf-8') as handle:
            handle.write('### Norwegian public schedule candidate\n\n')
            handle.write(f"Checked: {result['checked_at']}\n\nRecords: {result['records']}; ready: {result['ready_rows']}; held: {result['held_rows']}; duplicate groups: {result['duplicate_groups']}.\n\n")
            handle.write(f"Transport SHA-256: `{result['sha256']}`\n\nOnly public schedule facts are included. No Google/customer credentials are used.\n")
    return 0

if __name__=='__main__':raise SystemExit(main())
