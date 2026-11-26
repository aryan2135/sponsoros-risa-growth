"""Dependency-free xlsx -> CSV dumper (used for first-pass inspection only)."""
import zipfile, re, csv, sys, os, xml.etree.ElementTree as ET
NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def col2n(c):
    n=0
    for ch in c: n=n*26+ord(ch)-64
    return n-1
def dump(path,out):
    z=zipfile.ZipFile(path); os.makedirs(out,exist_ok=True)
    ss=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si',NS):
            ss.append(''.join(t.text or '' for t in si.iter('{%s}t'%NS['m'])))
    wb=ET.fromstring(z.read('xl/workbook.xml'))
    rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rmap={r.get('Id'):r.get('Target') for r in rels}
    for s in wb.find('m:sheets',NS):
        name=s.get('name'); rid=s.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        root=ET.fromstring(z.read('xl/'+rmap[rid].lstrip('/').replace('xl/','')))
        rows=[]
        for r in root.iter('{%s}row'%NS['m']):
            row={}
            for c in r.findall('m:c',NS):
                ref=re.match(r'([A-Z]+)',c.get('r')).group(1); t=c.get('t'); v=c.find('m:v',NS)
                if t=='s' and v is not None: val=ss[int(v.text)]
                elif t=='inlineStr': val=''.join(x.text or '' for x in c.iter('{%s}t'%NS['m']))
                else: val=v.text if v is not None else ''
                row[col2n(ref)]=val
            if row: rows.append([row.get(i,'') for i in range(max(row)+1)])
        with open(os.path.join(out,name.replace(' ','_')+'.csv'),'w',newline='',encoding='utf-8') as f: csv.writer(f).writerows(rows)
        print(name,len(rows))
dump(sys.argv[1],sys.argv[2])
