/* Pure functions shared by the separate itinerary project and Code by Zapier.
 * No network requests, file creation, customer messages, or source-sheet edits.
 */
function normalizeBooking(input) {
  input = input || {};
  var reasons = [];
  var ship = String(input.ship || '').trim().replace(/ +/g, ' ');
  var rawLine = String(input.cruise_line || input.line || '').trim();
  var line = '';
  if (/^Carnival(?:\s|$)/i.test(ship)) line = 'Carnival';
  else if (/^MSC(?:\s|$)/i.test(ship)) line = 'MSC';
  else if (/^Norwegian(?:\s|$)/i.test(ship) || /^Pride of America$/i.test(ship)) line = 'Norwegian';
  else if (/\bof the Seas$/i.test(ship)) line = 'Royal Caribbean';
  if (!ship) reasons.push('MISSING_BOOKING_SHIP');
  if (!line) reasons.push('UNSUPPORTED_OR_AMBIGUOUS_BOOKING_SHIP');
  if (rawLine) {
    var explicit = rawLine.toUpperCase().replace(/ /g, '');
    if (explicit !== line.toUpperCase().replace(/ /g, '')) {
      reasons.push('BOOKING_LINE_SHIP_CONFLICT');
    }
  }
  var sailDate = itineraryIsoDate(input.sail_date);
  var returnDate = itineraryIsoDate(input.return_date);
  if (!sailDate) reasons.push('INVALID_BOOKING_SAIL_DATE_USE_ISO');
  if (!returnDate) reasons.push('INVALID_BOOKING_RETURN_DATE_USE_ISO');
  var nights = sailDate && returnDate
    ? (Date.parse(returnDate + 'T00:00:00Z') - Date.parse(sailDate + 'T00:00:00Z')) / 86400000
    : null;
  if (nights !== null && (!Number.isInteger(nights) || nights < 1)) {
    reasons.push('BOOKING_RETURN_MUST_FOLLOW_SAIL_DATE');
  }
  var key = line && ship && sailDate ? itineraryKey(line, ship, sailDate) : '';
  return {
    ready: reasons.length === 0,
    review_required: reasons.length !== 0,
    review_reasons: reasons,
    review_reason: reasons.join('; '),
    lookup_key: key,
    cruise_line: line,
    ship: ship,
    sail_date: sailDate,
    return_date: returnDate,
    nights: nights
  };
}

function validateItinerary(input) {
  input = input || {};
  var reasons = [];
  function reject(reason) { if (reasons.indexOf(reason) < 0) reasons.push(reason); }
  if (!itineraryTrue(input.booking_ready)) reject('BOOKING_NOT_READY');
  if (!itineraryTrue(input.lookup_found)) reject('ITINERARY_NOT_FOUND');
  var expectedKey = String(input.booking_lookup_key || '').trim();
  var rowKey = String(input.lookup_key || '').trim();
  if (!expectedKey || rowKey !== expectedKey) reject('LOOKUP_KEY_MISMATCH');
  var sailDate = itineraryIsoDate(input.sail_date);
  var returnDate = itineraryIsoDate(input.return_date);
  var bookingSail = itineraryIsoDate(input.booking_sail_date);
  var bookingReturn = itineraryIsoDate(input.booking_return_date);
  if (!sailDate || !bookingSail || sailDate !== bookingSail) reject('SAIL_DATE_MISMATCH');
  if (!returnDate || !bookingReturn || returnDate !== bookingReturn) reject('RETURN_DATE_MISMATCH');
  var line = String(input.cruise_line || '').trim();
  var ship = String(input.ship || '').trim();
  var bookingLine = String(input.booking_cruise_line || '').trim();
  var bookingShip = String(input.booking_ship || '').trim();
  if (!line || !ship || !sailDate || itineraryKey(line, ship, sailDate) !== rowKey) {
    reject('ROW_IDENTITY_KEY_MISMATCH');
  }
  if (!bookingLine || !bookingShip || !bookingSail || itineraryKey(bookingLine, bookingShip, bookingSail) !== expectedKey) {
    reject('BOOKING_IDENTITY_KEY_MISMATCH');
  }
  var normalized = normalizeBooking({ship: ship, cruise_line: line, sail_date: sailDate, return_date: returnDate});
  if (!normalized.ready) reject('ROW_IDENTITY_NOT_SUPPORTED');
  var nights = itineraryInteger(input.nights);
  var bookingNights = itineraryInteger(input.booking_nights);
  var actualNights = sailDate && returnDate
    ? (Date.parse(returnDate + 'T00:00:00Z') - Date.parse(sailDate + 'T00:00:00Z')) / 86400000
    : null;
  if (nights === null || nights < 1 || nights !== bookingNights || nights !== actualNights) {
    reject('NIGHTS_MISMATCH');
  }
  if (itineraryInteger(input.lookup_matches) !== 1) reject('LOOKUP_NOT_UNIQUE');
  if (!itineraryTrue(input.feed_complete)) reject('SOURCE_FEED_INCOMPLETE');
  if (String(input.use_status || '').trim() !== 'DAY COUNT OK - VERIFY SOURCE') reject('WORKBOOK_REQUIRES_REVIEW');
  if (String(input.day_count_check || '').trim() !== 'COUNT MATCHES') reject('WORKBOOK_DAY_COUNT_NOT_OK');
  var expectedDays = itineraryInteger(input.expected_days);
  var listedDays = itineraryInteger(input.listed_days);
  if (nights === null || expectedDays !== nights + 1 || listedDays !== expectedDays) reject('WORKBOOK_DAY_COUNT_MISMATCH');
  var source = String(input.source || '').trim();
  var checkedAt = String(input.source_checked_at || '').trim();
  var sourceUrl = String(input.booking_url || '').trim();
  if (!source || !checkedAt) reject('SOURCE_PROVENANCE_MISSING');
  if (!/^https:\/\/[^\s<>"']+$/i.test(sourceUrl)) reject('SOURCE_LINK_MISSING_OR_INVALID');
  var dayPlan = String(input.day_plan || '').replace(/\r\n?/g, '\n').trim();
  var lines = dayPlan ? dayPlan.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : [];
  var days = [];
  lines.forEach(function (entry) {
    var match = /^DAY\s+(\d+)\s*:\s*(.+)$/i.exec(entry);
    if (!match) { reject('UNRECOGNIZED_DAY_PLAN_LINE'); return; }
    days.push({day: Number(match[1]), text: match[2].replace(/[\u00a0\u202f]/g, ' ').trim(), raw: entry});
  });
  if (!dayPlan) reject('DAY_PLAN_MISSING');
  if (expectedDays === null || days.length !== expectedDays) reject('DAY_PLAN_COUNT_MISMATCH');
  var structuredNcl = days.some(function(day) { return /^NCL EVENTS /.test(day.text); });
  if (structuredNcl) {
    if (line !== 'Norwegian') reject('NCL_EVENTS_REQUIRE_NORWEGIAN_SOURCE');
    var nclPlan = itineraryNclPlan(days, sailDate);
    nclPlan.review_reasons.forEach(reject);
    days = nclPlan.days;
  } else {
  days.forEach(function (day, index) {
    if (day.day !== index + 1) reject('DAY_SEQUENCE_REQUIRES_REVIEW');
    var parsed = itineraryParseDay(day.text);
    day.kind = parsed.kind;
    day.port = parsed.port || '';
    day.arrive = parsed.arrive;
    day.depart = parsed.depart;
    if (parsed.kind === 'unknown') reject('DAY_EVENT_OR_TIME_REQUIRES_REVIEW');
    var first = index === 0;
    var last = index === days.length - 1;
    if (first && !(parsed.kind === 'depart' || (parsed.kind === 'port' && parsed.depart !== null && parsed.arrive === null))) {
      reject('EMBARKATION_TIME_REQUIRES_REVIEW');
    }
    if (last && !(parsed.kind === 'return' || (parsed.kind === 'port' && parsed.arrive !== null && parsed.depart === null))) {
      reject('DISEMBARKATION_TIME_REQUIRES_REVIEW');
    }
    if (!first && !last && (parsed.kind === 'depart' || parsed.kind === 'return')) reject('DAY_EVENT_POSITION_REQUIRES_REVIEW');
    if (parsed.kind === 'port' && parsed.arrive !== null && parsed.depart !== null && parsed.depart < parsed.arrive) {
      reject('PORT_TIME_ORDER_REQUIRES_REVIEW');
    }
  });
  days.forEach(function (day, index) {
    if (day.kind !== 'port' || index === 0 || index === days.length - 1) return;
    if (day.arrive !== null && day.depart === null) {
      var next = days[index + 1];
      if (!next || next.kind !== 'port' || itineraryPort(next.port) !== itineraryPort(day.port) || next.arrive !== null || next.depart === null) {
        reject('OVERNIGHT_PORT_TIMES_REQUIRE_REVIEW');
      }
    } else if (day.arrive === null && day.depart !== null) {
      var previous = days[index - 1];
      if (!previous || previous.kind !== 'port' || itineraryPort(previous.port) !== itineraryPort(day.port) || previous.arrive === null || previous.depart !== null) {
        reject('OVERNIGHT_PORT_TIMES_REQUIRE_REVIEW');
      }
    } else if (day.arrive === null && day.depart === null) reject('PORT_TIMES_MISSING');
  });
  }
  var ready = reasons.length === 0;
  var sourceDateText = checkedAt;
  var heading = String(input.itinerary || 'Cruise itinerary').trim() || 'Cruise itinerary';
  var text = '';
  var html = '';
  if (ready) {
    text = [heading, line + ' | ' + ship, 'Sailing: ' + sailDate + ' to ' + returnDate + ' (' + nights + ' nights)', '',
      days.map(function(day) { return day.display || day.raw; }).join('\n'), '', 'Source: ' + source, 'Source checked at: ' + sourceDateText, 'Source booking page: ' + sourceUrl,
      'Itinerary and times are subject to change. Confirm final details with the cruise line.'].join('\n');
    html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + itineraryEscape(heading) +
      '</title><style>body{font:12pt Arial,sans-serif;color:#17324d;margin:36pt}h1{font-size:22pt}li{margin:10pt 0}footer{font-size:9pt;color:#555;margin-top:24pt}</style></head><body><h1>' +
      itineraryEscape(heading) + '</h1><p>' + itineraryEscape(line + ' | ' + ship) + '</p><p>' +
      itineraryEscape('Sailing: ' + sailDate + ' to ' + returnDate + ' (' + nights + ' nights)') + '</p><ul>' +
      days.map(function (day) { return '<li>' + itineraryEscape(day.display || day.raw) + '</li>'; }).join('') + '</ul><footer><p>' +
      itineraryEscape('Source: ' + source + ' | Source checked at: ' + sourceDateText) + '</p><p><a href="' + itineraryEscape(sourceUrl) +
      '">Source booking page</a></p><p>Itinerary and times are subject to change. Confirm final details with the cruise line.</p></footer></body></html>';
  }
  return {ready: ready, review_required: !ready, review_reasons: reasons, review_reason: reasons.join('; '), lookup_key: expectedKey,
    day_count: days.length, document_text: text, document_html: html, source_checked_at: checkedAt, source_url: sourceUrl};
}

function itineraryKey(line, ship, isoDate) {
  return String(line).trim().replace(/ /g, '').toUpperCase() + '|' +
    String(ship).trim().replace(/[ .-]/g, '').toUpperCase() + '|' + isoDate;
}
function itineraryIsoDate(value) {
  var text = String(value == null ? '' : value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  var date = new Date(text + 'T00:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : '';
}
function itineraryInteger(value) {
  var text = String(value == null ? '' : value).trim();
  if (!/^\d+(?:\.0+)?$/.test(text)) return null;
  var result = Number(text);
  return Number.isSafeInteger(result) ? result : null;
}
function itineraryTrue(value) { return value === true || String(value).trim().toUpperCase() === 'TRUE'; }
function itineraryPort(value) { return String(value).trim().replace(/\s+/g, ' ').toUpperCase(); }
function itineraryEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function itineraryClock(value) {
  var match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(value).trim());
  if (!match) return null;
  var hour = Number(match[1]), minute = Number(match[2]);
  if (minute > 59) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  } else if (match[1].length !== 2 || hour > 23) return null;
  return hour * 60 + minute;
}
function itineraryParseDay(text) {
  if (/^At Sea$/i.test(text)) return {kind: 'sea', arrive: null, depart: null};
  var time = '(\\d{1,2}:\\d{2}\\s*(?:AM|PM)?)';
  var departure = new RegExp('^Depart (.+?) at ' + time + '$', 'i').exec(text);
  if (departure && itineraryClock(departure[2]) !== null) return {kind: 'depart', port: departure[1], arrive: null, depart: itineraryClock(departure[2])};
  var returned = new RegExp('^Return to (.+?) at ' + time + '$', 'i').exec(text);
  if (returned && itineraryClock(returned[2]) !== null) return {kind: 'return', port: returned[1], arrive: itineraryClock(returned[2]), depart: null};
  var port = /^(.+?)\s+[—–-]\s+(.+)$/.exec(text);
  if (!port) return {kind: 'unknown', arrive: null, depart: null};
  var event = new RegExp('^arrive ' + time + '(?:,\\s*depart ' + time + ')?$', 'i').exec(port[2]);
  if (event) {
    var arrivalTime = itineraryClock(event[1]);
    var departureTime = event[2] ? itineraryClock(event[2]) : null;
    if (arrivalTime === null || (event[2] && departureTime === null)) return {kind: 'unknown', arrive: null, depart: null};
    return {kind: 'port', port: port[1], arrive: arrivalTime, depart: departureTime};
  }
  var onlyDeparture = new RegExp('^depart ' + time + '$', 'i').exec(port[2]);
  if (onlyDeparture && itineraryClock(onlyDeparture[1]) !== null) return {kind: 'port', port: port[1], arrive: null, depart: itineraryClock(onlyDeparture[1])};
  return {kind: 'unknown', arrive: null, depart: null};
}

/** Strict NCL daily-event contract. Every retained clock/date comes from a dated package event. */
function itineraryNclPlan(inputDays, sailDate) {
  var reasons=[],days=[],open=null,previousOrder=0,previousClock=-1;
  function reject(reason) {if(reasons.indexOf(reason)<0)reasons.push(reason);}
  function clockText(minutes) {return (Math.floor(minutes/60)%12||12)+':'+String(minutes%60).padStart(2,'0')+' '+(minutes>=720?'PM':'AM');}
  function makeSegment(event,kind) {return {kind:kind,port:event.title,port_code:event.portCode,arrive:null,depart:null,at:null};}
  inputDays.forEach(function(day,index) {
    var out={day:day.day,raw:day.raw,text:day.text,segments:[],display:''};days.push(out);
    if(day.day!==index+1)reject('DAY_SEQUENCE_REQUIRES_REVIEW');
    if(!/^NCL EVENTS /.test(day.text)) {reject('NCL_DAY_EVENT_CONTRACT_MIXED');return;}
    var events;
    try {events=JSON.parse(day.text.slice(11));}catch(_){reject('NCL_DAY_EVENT_JSON_INVALID');return;}
    if(!Array.isArray(events)||!events.length||events.length>24) {reject('NCL_DAY_EVENTS_MISSING_OR_EXCESSIVE');return;}
    previousClock=-1;
    events.forEach(function(event,eventIndex) {
      if(!event||typeof event!=='object'||Array.isArray(event)) {reject('NCL_SOURCE_EVENT_INVALID');return;}
      var type=event.event, match=/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::00)?$/.exec(String(event.date||''));
      var clock=match?itineraryClock(match[2]):null;
      var expected=sailDate?new Date(Date.parse(sailDate+'T00:00:00Z')+index*86400000).toISOString().slice(0,10):'';
      if(!match||!itineraryIsoDate(match[1])||match[1]!==expected||clock===null) {reject('NCL_EVENT_DATE_OR_CLOCK_INVALID');return;}
      if(!Number.isInteger(event.eventOrder)||event.eventOrder!==previousOrder+1||clock<previousClock)reject('NCL_EVENT_ORDER_INVALID');
      previousOrder=event.eventOrder;previousClock=clock;
      if(event.isIdlCrossing===true)reject('NCL_DATE_LINE_REQUIRES_REVIEW');
      if(['ARRIVAL','DEPARTURE','AT_SEA','SCENIC'].indexOf(type)<0) {reject('NCL_EVENT_TYPE_UNSUPPORTED');return;}
      if(type!=='AT_SEA'&&(typeof event.title!=='string'||!event.title.trim()||typeof event.portCode!=='string'||!event.portCode.trim())) {reject('NCL_EVENT_PORT_IDENTITY_MISSING');return;}
      var first=index===0&&eventIndex===0,last=index===inputDays.length-1&&eventIndex===events.length-1;
      if(first&&!(type==='DEPARTURE'&&event.isEmbarkation===true))reject('EMBARKATION_TIME_REQUIRES_REVIEW');
      if(last&&!(type==='ARRIVAL'&&event.isDisembarkation===true))reject('DISEMBARKATION_TIME_REQUIRES_REVIEW');
      if(event.isEmbarkation===true&&!first)reject('NCL_EMBARKATION_EVENT_POSITION_INVALID');
      if(event.isDisembarkation===true&&!last)reject('NCL_DISEMBARKATION_EVENT_POSITION_INVALID');
      var segment,same=open&&open.port_code===event.portCode&&itineraryPort(open.port)===itineraryPort(event.title);
      if(type==='ARRIVAL') {
        var terminalOvernight=last&&same&&open.day<index;
        if(open&&!terminalOvernight)reject('NCL_ARRIVAL_WITHOUT_PREVIOUS_DEPARTURE');
        segment=makeSegment(event,terminalOvernight?'disembark':last?'return':'port');segment.arrive=clock;out.segments.push(segment);
        if(last)open=null;
        else open={port_code:event.portCode,port:event.title,day:index,segment:segment};
      } else if(type==='DEPARTURE') {
        if(first) {segment=makeSegment(event,'depart');segment.depart=clock;out.segments.push(segment);}
        else {
          if(!same)reject('NCL_DEPARTURE_WITHOUT_MATCHING_ARRIVAL');
          if(same&&open.day===index)open.segment.depart=clock;
          else {segment=makeSegment(event,'port');segment.depart=clock;out.segments.push(segment);}
          open=null;
        }
      } else if(type==='SCENIC') {
        // NCL also labels an intermediate overnight-in-port marker SCENIC.
        // A still-open arrival at the identical port proves that this is a stay.
        if(open&&!same)reject('NCL_SCENIC_CONFLICTS_WITH_PORT_STAY');
        segment=makeSegment(event,same?'stay':'scenic');segment.at=clock;out.segments.push(segment);
      } else {
        if(open)reject('NCL_AT_SEA_CONFLICTS_WITH_PORT_STAY');
        segment=makeSegment(event,'sea');out.segments.push(segment);
      }
    });
    out.display='DAY '+day.day+': '+out.segments.map(function(s) {
      if(s.kind==='sea')return 'At Sea';
      if(s.kind==='scenic')return 'Scenic cruising: '+s.port+' at '+clockText(s.at);
      if(s.kind==='stay')return s.port+' — overnight in port';
      if(s.kind==='disembark')return 'Disembarkation: '+s.port+' at '+clockText(s.arrive);
      var parts=[];if(s.arrive!==null)parts.push('arrive '+clockText(s.arrive));if(s.depart!==null)parts.push('depart '+clockText(s.depart));
      return s.port+' — '+parts.join(', ');
    }).join('; ');
  });
  if(open)reject('NCL_ARRIVAL_WITHOUT_LATER_DEPARTURE');
  return {ready:reasons.length===0,review_reasons:reasons,days:days};
}

/** Human worksheet representation; machine events remain separate and unchanged. */
function itineraryNclDisplayPlan(dayPlan,sailDate) {
  var days=String(dayPlan||'').replace(/\r\n?/g,'\n').trim().split('\n').filter(Boolean).map(function(raw) {
    var m=/^DAY\s+(\d+)\s*:\s*(NCL EVENTS .+)$/.exec(raw.trim());
    if(!m)throw new Error('NCL_DISPLAY_REQUIRES_STRUCTURED_EVENTS');
    return {day:Number(m[1]),raw:raw,text:m[2]};
  });
  var parsed=itineraryNclPlan(days,sailDate);
  if(parsed.ready)return parsed.days.map(function(day){return day.display;}).join('\n');
  // Review rows also stay readable. Preserve every supplied event/date when a
  // contradiction prevents interpreting it as a validated port call or stay.
  return days.map(function(day) {
    var events=JSON.parse(day.text.slice(11));
    if(!Array.isArray(events))throw new Error('NCL_DISPLAY_REQUIRES_EVENT_ARRAY');
    return 'DAY '+day.day+': '+events.map(function(event) {
      if(event.event==='AT_SEA')return 'At Sea';
      var label=event.event==='ARRIVAL'?'arrival':event.event==='DEPARTURE'?'departure':'carrier event '+String(event.event||'');
      return String(event.title||event.portCode||'')+' — '+label+' '+String(event.date||'').replace('T',' ');
    }).join('; ');
  }).join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {normalizeBooking: normalizeBooking, validateItinerary: validateItinerary, itineraryNclPlan:itineraryNclPlan,
    itineraryNclDisplayPlan:itineraryNclDisplayPlan};
}
