const SID='1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY';
function doGet(e){return HtmlService.createHtmlOutputFromFile('Index').setTitle('Aimino Dashboard').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);}
function getOverview(){
  var ss=SpreadsheetApp.openById(SID),now=new Date();
  var pd=rs(ss,'project-overview','A2:L5');
  var cd=rs(ss,'guerrilla-content-plan','A2:K500');
  var tw=rs(ss,'twitter-campaign','A2:O30');
  var li=rs(ss,'linkedin-campaign','A2:O30');
  var hn=rs(ss,'hacker-news-campaign','A2:M30');
  var dc=rs(ss,'discord-campaign','A2:M30');
  var mp=rs(ss,'Public-marketplaces','A2:G20');
  var rp=0,pl=0;
  for(var i=0;i<cd.length;i++){var s=String(cd[i][9]||'').toLowerCase();if(s.indexOf('replied')>=0||s.indexOf('repled')>=0)rp++;else if(s.indexOf('planned')>=0)pl++;}
  var p={reddit:{t:cd.length,r:rp,p:pl},twitter:{t:tw.length},linkedin:{t:li.length},hackernews:{t:hn.length},discord:{t:dc.length},marketplaces:{t:mp.length,pub:mp.filter(function(r){return String(r[3]||'').indexOf('Published')>=0;}).length}};
  var rt=cd.length,er=rt>0?rp/rt:0,ap=0;for(var k in p)if(p[k].t>0)ap++;
  var qs=Math.min(Math.round((er*30)+((ap/6)*20)+(Math.min(rt/100,1)*25)+15+(p.marketplaces.pub>0?10:0)),100);
  var proj=pd.map(function(r){return{id:r[0],name:r[1],url:r[2]||'',desc:r[3]||'',status:r[10]||'Active',qs:qs};});
  var trend=[];
  for(var i=13;i>=0;i--){var d=new Date(now-i*86400000),ds=d.toISOString().split('T')[0],c=0;for(var j=0;j<cd.length;j++){var dd=String(cd[j][7]||cd[j][6]||'');if(dd.indexOf(ds)>=0)c++;}trend.push({d:ds,c:c});}
  var subs={};for(var i=0;i<cd.length;i++){var m=String(cd[i][2]||'').match(/r\/([\w-]+)/);var sub=m?m[1]:'other';if(!subs[sub])subs[sub]={t:0,r:0};subs[sub].t++;var s=String(cd[i][9]||'').toLowerCase();if(s.indexOf('replied')>=0||s.indexOf('repled')>=0)subs[sub].r++;}
  return{projects:proj,platforms:p,subs:subs,trend:trend,at:new Date().toISOString()};
}
function getActivity(){
  var ss=SpreadsheetApp.openById(SID),items=[];
  var rd=rs(ss,'guerrilla-content-plan','A2:K30');
  for(var i=rd.length-1;i>=0;i--)if(rd[i][0])items.push({p:'Reddit',c:String(rd[i][5]||'').substring(0,100),d:rd[i][7]||rd[i][6]||'',s:rd[i][9]});
  var tw=rs(ss,'twitter-campaign','A2:O10');
  for(var i=tw.length-1;i>=0;i--)if(tw[i][0])items.push({p:'Twitter',c:String(tw[i][5]||'').substring(0,100),d:tw[i][8]||tw[i][7]||'',s:tw[i][10]});
  return items.slice(0,30);
}
function rs(ss,n,r){try{var sh=ss.getSheetByName(n);if(!sh)return[];return sh.getRange(r).getValues().filter(function(r){return r.some(function(c){return c!=='';});});}catch(e){return[];}}
