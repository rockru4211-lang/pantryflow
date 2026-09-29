import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
export async function readRecipeFile(file:File):Promise<string>{
 if(file.size>10*1024*1024)throw Error('請上傳 10MB 以下的食譜。');
 const bytes=await file.arrayBuffer();
 if(file.name.toLowerCase().endsWith('.pdf')){
  const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs');pdf.GlobalWorkerOptions.workerSrc=workerUrl;
  const doc=await pdf.getDocument({data:bytes,isEvalSupported:false}).promise;
  try{if(doc.numPages>30)throw Error('請將食譜拆成 30 頁以下。');const pages:string[]=[];
   for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n);const t=await p.getTextContent();let y:number|undefined;let line='';const rows:string[]=[];
    for(const item of t.items){if(!('str'in item))continue;const nextY=item.transform[5];if(y!==undefined&&Math.abs(nextY-y)>4){rows.push(line);line='';}line+=item.str+' ';y=nextY;}rows.push(line);pages.push(rows.join('\n'));}
   const text=pages.join('\n');if(!text.trim())throw Error('此 PDF 是掃描圖片，請改用文字食譜或手動建立。');return text;
  }finally{await doc.destroy();}
 }
 if(!file.name.toLowerCase().endsWith('.docx'))throw Error('請選擇 Word（.docx）或 PDF。');
 // Read the exact DOCX document part using the ZIP central directory, including data-descriptor archives.
 const view=new DataView(bytes);let end=-1;
 for(let i=bytes.byteLength-22;i>=Math.max(0,bytes.byteLength-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw Error('無法讀取 Word 檔案。');
 let offset=view.getUint32(end+16,true);const count=view.getUint16(end+10,true);const decoder=new TextDecoder();
 for(let n=0;n<count;n++){
  if(view.getUint32(offset,true)!==0x02014b50)break;
  const method=view.getUint16(offset+10,true),size=view.getUint32(offset+20,true),uncompressed=view.getUint32(offset+24,true),len=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true),local=view.getUint32(offset+42,true);
  const name=decoder.decode(bytes.slice(offset+46,offset+46+len));offset+=46+len+extra+comment;
  if(name!=='word/document.xml')continue;
  if(uncompressed>5*1024*1024)throw Error('食譜文字過長，請分開上傳。');
  const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);const part=bytes.slice(start,start+size);
  if(method!==0&&method!==8)throw Error('此 Word 壓縮格式不支援，請另存為 PDF。');
  const xml=method===0?decoder.decode(part):await new Response(new Blob([part]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  const parsed=new DOMParser().parseFromString(xml,'application/xml');if(parsed.querySelector('parsererror'))throw Error('Word 內容無法解析。');
  return Array.from(parsed.getElementsByTagNameNS('*','p')).map(p=>Array.from(p.getElementsByTagNameNS('*','t')).map(t=>t.textContent).join('')).join('\n');
 }
 throw Error('Word 檔案缺少食譜內容。');
}
