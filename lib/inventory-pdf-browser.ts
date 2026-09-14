import {parsePdfTextPages,type PdfTextItem} from './inventory-pdf';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
export async function readInventoryPdf(data:ArrayBuffer) {
 const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
 const doc=await pdfjs.getDocument({data:data.slice(0),isEvalSupported:false}).promise;
 try{if(doc.numPages>60)throw Error('PDF 最多支援 60 頁，請分成較小檔案。');const pages:PdfTextItem[][]=[];
 for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i);const text=await page.getTextContent();pages.push(text.items.filter(x=>'str'in x).map(x=>({str:x.str,x:x.transform[4],y:x.transform[5]})));}
 return parsePdfTextPages(pages);
 }finally{await doc.destroy();}
}
