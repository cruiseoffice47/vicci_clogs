'use strict';
const DAY=86400000,epoch=25569;
function instantSerial(v){
 const ms=Date.parse(v);if(!Number.isFinite(ms)||!/(?:Z|[+-]\d\d:\d\d)$/.test(v||''))throw Error('Expected timestamp with timezone');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(ms).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 return Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second)/DAY+epoch;
}
module.exports={instantSerial};
