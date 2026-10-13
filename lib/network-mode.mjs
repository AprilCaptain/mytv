import { networkInterfaces } from 'node:os';
export function privateV4(ip){const a=ip.split('.').map(Number);return a.length===4&&a.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(a[0]===10||a[0]===192&&a[1]===168||a[0]===172&&a[1]>=16&&a[1]<=31);}
export function serverAddresses(port,lan=false,interfaces=networkInterfaces()) {
  const addresses=[...new Set(Object.values(interfaces).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal&&privateV4(i.address)).map(i=>i.address))];
  return {mode:lan?'lan':'local',host:lan?'0.0.0.0':'127.0.0.1',
    allowedHosts:new Set(['127.0.0.1:'+port,'localhost:'+port,...(lan?addresses.map(ip=>ip+':'+port):[])]),
    urls:addresses.map(ip=>'http://'+ip+':'+port)};
}
