// Exact shared pure mapping functions only. No Google IDs, services or installer.
const NORWEGIAN_FEED_CONFIG=Object.freeze({headers:["Sail Date","Return Date","Year","Month","Nights","Ship","Itinerary","Departure Port","Visiting","Interior Price PP","Interior Total for 2","Ocean View Price PP","Ocean View Total for 2","Balcony Price PP","Balcony Total for 2","Lowest Total for 2","Lowest Cabin","Booking URL","Last Checked","Source","Feed Complete","Feed Retrieved At","Feed Count","Feed Coverage Years","Day Plan","Structured Day Events"]});

function norwegianRecord_(route,payloadPackage,data,checkedAt,url) {
  const p=payloadPackage,start=p.start,end=p.end,nights=(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
  const issues=[],groups={},events=Array.isArray(data.events)?data.events:[];
  if(data.itineraryCode!==p.code) issues.push('ITINERARY_CODE_MISMATCH');
  if(String(data.packageId)!==p.packageId) issues.push('PACKAGE_ID_MISMATCH');
  if(!events.length) issues.push('NO_SOURCE_EVENTS');
  events.forEach(event=>{
    const day=event.relativeCalendarDay;
    if(!Number.isInteger(day)||day<1) {issues.push('INVALID_RELATIVE_DAY');return;}
    if(!groups[day]) groups[day]=[];groups[day].push(event);
    if(norwegianIso_(event.date)!==norwegianAddDays_(start,day-1)) issues.push('CALENDAR_DATE_MISMATCH');
    if(event.isIdlCrossing) issues.push('DATE_LINE_REQUIRES_REVIEW');
    if(['ARRIVAL','DEPARTURE','AT_SEA','SCENIC'].indexOf(event.event)<0) issues.push('UNKNOWN_SOURCE_EVENT');
    if(day>nights+1) issues.push('EVENT_OUTSIDE_SAILING');
  });
  const lines=[];
  for(let day=1;day<=nights+1;day++) {
    const es=(groups[day]||[]).slice().sort((a,b)=>(a.eventOrder||0)-(b.eventOrder||0));
    if(!es.length) {issues.push('MISSING_SOURCE_DAY');continue;}
    const keys=['event','date','title','portCode','isEmbarkation','isDisembarkation','isIdlCrossing','eventOrder'];
    lines.push('DAY '+day+': NCL EVENTS '+JSON.stringify(es.map(event=>{
      const out={};keys.forEach(key=>{out[key]=event[key]===undefined?null:event[key];});return out;
    })));
  }
  const record={lookup_key:'NORWEGIAN|'+route.ship.replace(/[ .-]/g,'').toUpperCase()+'|'+start,cruise_line:'Norwegian',
    ship:route.ship,sail_date:start,return_date:end,nights:nights,itinerary:route.title,departure_port:route.departure_port,
    visiting_ports:route.visiting_ports,day_plan:lines.join('\n'),source_checked_at:checkedAt,feed_complete:issues.length===0,
    booking_url:url,source:'Norwegian official dated itinerary',review_reasons:[...new Set(issues)]};
  // Apply exactly the delivery parser's readiness rules before publishing feed_complete.
  const n=normalizeBooking({ship:record.ship,line:'Norwegian',sail_date:start,return_date:end});
  const checked=validateItinerary({booking_ready:n.ready,lookup_found:true,booking_lookup_key:n.lookup_key,lookup_key:record.lookup_key,
    booking_cruise_line:'Norwegian',cruise_line:'Norwegian',booking_ship:record.ship,ship:record.ship,
    booking_sail_date:start,sail_date:start,booking_return_date:end,return_date:end,booking_nights:nights,nights:nights,
    lookup_matches:1,feed_complete:record.feed_complete,use_status:'DAY COUNT OK - VERIFY SOURCE',
    day_count_check:lines.length===nights+1?'COUNT MATCHES':'DAY COUNT MISMATCH',expected_days:nights+1,listed_days:lines.length,
    day_plan:record.day_plan,source:record.source,source_checked_at:checkedAt,booking_url:url});
  if(!checked.ready) {record.feed_complete=false;record.review_reasons=[...new Set(record.review_reasons.concat(checked.review_reasons))];}
  return record;
}

function norwegianRows_(records,retrievedAt) {
  const years=JSON.stringify([...new Set(records.map(r=>Number(r.sail_date.slice(0,4))))].sort()),
    months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  return records.map(r=>[norwegianSerial_(r.sail_date),norwegianSerial_(r.return_date),Number(r.sail_date.slice(0,4)),
    months[Number(r.sail_date.slice(5,7))-1],r.nights,r.ship,r.itinerary,r.departure_port,r.visiting_ports,
    '','','','','','','','',r.booking_url,new Date(r.source_checked_at),r.source,r.feed_complete,retrievedAt,records.length,years,
    itineraryNclDisplayPlan(r.day_plan,r.sail_date),r.day_plan]);
}

function norwegianIso_(value) {
  const text=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return '';
  const date=new Date(text+'T00:00:00Z');return !isNaN(date.getTime())&&date.toISOString().slice(0,10)===text?text:'';
}

function norwegianAddDays_(iso,days) {return new Date(Date.parse(iso+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}

function norwegianSerial_(iso) {return Date.parse(iso+'T00:00:00Z')/86400000+25569;}
