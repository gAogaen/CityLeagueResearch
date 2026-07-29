import csv,re,os,json
from collections import defaultdict
src='/mnt/data/cityleague_results(5).csv'
outdir='/mnt/data/cityv5/data'
os.makedirs(outdir,exist_ok=True)
PREFS=['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県']
storemap={}
with open(outdir+'/store_prefecture_map.csv',encoding='utf-8-sig') as f:
 for r in csv.DictReader(f): storemap[r['店名'].strip()]=r['都道府県'].strip()
def clean(x): return str(x or '').replace('\u3000',' ').strip()
def shop(x): return re.sub(r'^主催者\s*[:：]\s*','',clean(x)).strip()
def cat(x):
 x=clean(x)
 if 'ジュニア' in x:return 'ジュニア'
 if 'シニア' in x:return 'シニア'
 if 'マスター' in x or 'オープン' in x:return 'オープン'
 return ''
def year(name,date):
 m=re.search(r'シティリーグ\s*(20\d{2})',name or '')
 if m:return int(m.group(1))
 m=re.match(r'(20\d{2})-(\d{2})',date or '')
 if not m:return 0
 y,mo=map(int,m.groups()); return y+1 if mo>=9 else y
def pref_from_text(t):
 # 元ページには住所表記の揺れが多いため、固定長の正規表現ではなく
 # 47都道府県の正式名称を本文全体から直接検出する。
 t=clean(t)
 if not t:return ''
 for pref in PREFS:
  if pref in t:return pref
 return ''
def shop_from_text(t):
 m=re.search(r'主催者\s*[:：]\s*([^\n\r]+)',t or '')
 return shop(m.group(1)) if m else ''
def choose_shop(a,b):
 a,b=shop(a),shop(b)
 return a if len(a)>=len(b) else b
def csp(text,rank,yr):
 if text:
  m=re.search(rf'{rank}\s*位[\s\S]{{0,24}}?(\d{{1,3}})\s*pt',text,re.I)
  if m:return int(m.group(1))
  pts=re.findall(r'(\d{1,3})\s*pt',text,re.I)
  if len(pts)==1:return int(pts[0])
 if yr>=2024:
  if rank==1:return 100
  if rank==2:return 75
  if rank<=4:return 50
  if rank<=8:return 25
  if rank<=16:return 15
 return ''
# pass 1 event metadata
meta={}
with open(src,encoding='utf-8-sig',newline='') as f:
 for r in csv.DictReader(f):
  eid=clean(r.get('大会ID'))
  if not eid: continue
  t=r.get('元テキスト','')
  s=choose_shop(shop_from_text(t),r.get('店名',''))
  p=pref_from_text(t) or storemap.get(s,'') or storemap.get(shop(r.get('店名','')),'')
  cur=meta.get(eid,{})
  if len(s)>len(cur.get('shop','')):cur['shop']=s
  if p:cur['pref']=p
  cur['name']=cur.get('name') or clean(r.get('大会名'))
  cur['date']=cur.get('date') or clean(r.get('開催日'))
  meta[eid]=cur

# 同じ会場名で都道府県が判明している大会から多数決マップを作成する。
venue_pref_counts=defaultdict(lambda: defaultdict(int))
for item in meta.values():
 s=shop(item.get('shop','')); p=item.get('pref','')
 if s and p: venue_pref_counts[s][p]+=1
venue_pref={s:max(counts,key=counts.get) for s,counts in venue_pref_counts.items() if counts}
for item in meta.values():
 if not item.get('pref'):
  item['pref']=venue_pref.get(shop(item.get('shop','')),'')

headers=['開催日','シティ年度','大会名','会場名','開催都道府県','大会カテゴリ','順位','獲得CSP','プレイヤーID','プレイヤー名','大会ID','詳細URL']
rows=[]; seen={}; stats=defaultdict(int)
with open(src,encoding='utf-8-sig',newline='') as f:
 for r in csv.DictReader(f):
  t=r.get('元テキスト',''); eid=clean(r.get('大会ID')); m=meta.get(eid,{})
  ids=set(re.findall(r'(?:プレイヤーID\s*[:：]\s*)?(\d{8,12})',t))
  if len(ids)>1 and not clean(r.get('詳細URL')): stats['aggregate']+=1; continue
  pid=re.sub(r'\D','',clean(r.get('プレイヤーID')))
  if not pid:
   mm=re.search(r'プレイヤーID\s*[:：]\s*(\d{8,12})',t); pid=mm.group(1) if mm else ''
  if not pid: stats['badid']+=1; continue
  pid=pid.zfill(10) if len(pid)<=10 else pid
  try: rank=int(re.search(r'\d+',clean(r.get('順位'))).group())
  except: 
   mm=re.search(r'(\d{1,3})\s*位',t)
   if not mm: stats['badrank']+=1; continue
   rank=int(mm.group(1))
  date=clean(r.get('開催日')) or m.get('date',''); name=clean(r.get('大会名')) or m.get('name','')
  yr=year(name,date); category=cat(r.get('大会カテゴリ')) or cat(name)
  s=choose_shop(r.get('店名',''),m.get('shop',''))
  p=m.get('pref','') or storemap.get(s,'') or venue_pref.get(shop(s),'') or pref_from_text(t)
  points=csp(t,rank,yr)
  pname=clean(r.get('プレイヤー名'))
  row=[date,yr,name,s,p,category,rank,points,pid,pname,eid,clean(r.get('詳細URL'))]
  key=(eid or date+'|'+name+'|'+s,pid,rank)
  score=(bool(p)*3+bool(s)*2+bool(points!='')*2+bool(row[11])*4)
  if key not in seen or score>seen[key][0]: seen[key]=(score,row)
rows=[x[1] for x in seen.values()]
rows.sort(key=lambda x:(x[0],x[10],x[6],x[8]),reverse=True)
for path, subset in [(outdir+'/cityleague_results.csv',rows)]:
 with open(path,'w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f,lineterminator='\n');w.writerow(headers);w.writerows(subset)
by=defaultdict(list)
for r in rows: by[r[1]].append(r)
for y,rr in by.items():
 with open(f'{outdir}/cityleague_results_{y}.csv','w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f,lineterminator='\n');w.writerow(headers);w.writerows(rr)
manifest={'version':5,'rowCount':len(rows),'years':[{ 'year':y,'file':f'cityleague_results_{y}.csv','rows':len(by[y])} for y in sorted(by,reverse=True)]}
with open(outdir+'/manifest.json','w',encoding='utf-8') as f:json.dump(manifest,f,ensure_ascii=False,indent=2)
print('rows',len(rows),'years',[(y,len(by[y])) for y in sorted(by,reverse=True)])
print('stats',dict(stats))
