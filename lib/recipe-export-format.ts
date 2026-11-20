// SheetJS CE writes the data and numeric formats. Apply the supplied template's
// plain font and paired-name highlight to the resulting OOXML package.
export async function formatRecipeWorkbook(bytes:Uint8Array):Promise<Uint8Array<ArrayBuffer>>{
 const {default:CFB}=await import('cfb');
 const zip=CFB.read(bytes,{type:'buffer'}),decoder=new TextDecoder(),encoder=new TextEncoder();
 function read(path:string){const entry=CFB.find(zip,`/${path}`);if(!entry)throw Error('食譜匯出格式不完整，請重新匯出。');return decoder.decode(new Uint8Array(entry.content));}
 function write(path:string,xml:string){CFB.utils.cfb_add(zip,`/${path}`,encoder.encode(xml));}
 let styles=read('xl/styles.xml');
 styles=styles.replace(/<fonts\b[^>]*>[\s\S]*?<\/fonts>/,match=>match.replace(/<font>[\s\S]*?<\/font>/,'<font><sz val="12"/><name val="新細明體"/></font>'));
 let fillId=0,wrapId=0,pairedId=0;
 styles=styles.replace(/<fills count="(\d+)">([\s\S]*?)<\/fills>/,(_match,count,body)=>{
  fillId=Number(count);return `<fills count="${fillId+1}">${body}<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills>`;
 });
 styles=styles.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/,(_match,count,body)=>{
  wrapId=Number(count);pairedId=wrapId+1;
  const xf=(fill:number)=>`<xf numFmtId="0" fontId="0" fillId="${fill}" borderId="0" xfId="0" applyAlignment="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf>`;
  return `<cellXfs count="${wrapId+2}">${body}${xf(0)}${xf(fillId)}</cellXfs>`;
 });
 if(!wrapId||!pairedId)throw Error('食譜匯出格式不完整，請重新匯出。');
 write('xl/styles.xml',styles);
 let summary=read('xl/worksheets/sheet1.xml');
 summary=summary.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g,(row,rowNumber)=>{
  if(Number(rowNumber)===1)return row;
  const posCell=row.match(new RegExp(`<c\\b[^>]*\\br="B${rowNumber}"[^>]*>[\\s\\S]*?<\\/c>`))?.[0]||'';
  const paired=/<(?:v|t)(?:\s[^>]*)?>[^<]+<\/(?:v|t)>/.test(posCell);
  return row.replace(/<c\b([^>]*\br="([BC])\d+"[^>]*)>/g,(_cell,attributes)=>`<c${attributes.replace(/\s+s="\d+"/,'')} s="${paired?pairedId:wrapId}">`);
 });
 write('xl/worksheets/sheet1.xml',summary);
 return new Uint8Array(CFB.write(zip,{fileType:'zip',type:'buffer',compression:true}));
}
