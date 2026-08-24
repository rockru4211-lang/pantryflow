import{escapeHtml}from'../components/layout.js';

const roleContent={
  OWNER:{heading:'商家營運總覽',intro:'先完成門市與人員設定，再開始正式作業。',highlights:[['商家與門市','確認正式門市與 Owner 權限','profile'],['成員設定','建立主管與員工個人身分','profile']],review:[['門市建置狀態','前往設定','profile']]},
  ADMIN:{heading:'今天需要留意的事',intro:'正常資料保持收起，只把異常與待確認事項放到前面。',highlights:[['盤點差異','正式盤點完成後顯示差異與原因','count'],['進貨待核對','OCR 完成後顯示需要人工確認的貨單','receiving']],review:[['盤點差異','尚無正式待處理資料','count']]},
  SUPERVISOR:{heading:'今天的門市作業',intro:'安排現場工作，並處理員工送出的差異與異常。',highlights:[['盤點安排','查看正式盤點任務與區域','count'],['進貨確認','查看門市上傳的正式貨單','receiving']],review:[['盤點差異','尚無正式待處理資料','count']]},
  LOGISTICS:{heading:'今天的後勤核對',intro:'集中查看正式收據與需要人工判斷的欄位。',highlights:[['進貨待核對','原圖與 OCR 完成後顯示於此','receiving'],['辨識異常','只顯示正式 OCR 的疑問與失敗','receiving']],review:[['進貨核對','尚無正式待處理資料','receiving']]},
  STAFF:{heading:'今天要完成的工作',intro:'只顯示主管指派的現場作業；盲盤不會顯示帳面數字。',highlights:[['盤點任務','主管指派後會顯示正式區域','count'],['進貨上傳','拍攝清楚貨單，上傳後即可離開','receiving']],review:[['待處理作業','目前沒有正式指派','activity']]}
};

const dailyWork=[
  ['盤點','依區域完成盲盤','count',true,'✓'],
  ['進貨','上傳貨單或進行後勤核對','receiving',true,'▤'],
  ['報廢','尚未開放','waste',false,'↘'],
  ['效期巡檢','尚未開放','expiry',false,'◷'],
  ['其他作業','尚未開放','other',false,'＋']
];

function workRows(items){return items.map(([title,copy,feature,enabled,icon])=>`<button class="work-row ${enabled?'':'is-disabled'}" ${enabled?`data-feature="${feature}"`:'disabled'}><span class="work-icon">${icon}</span><span class="work-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></span><span class="row-arrow">${enabled?'›':'—'}</span></button>`).join('')}

export function homePage({role='STAFF',storeName='',erpEnabled=false}={}){
  const content=roleContent[role]||roleContent.STAFF;
  const review=[...content.review];
  if(erpEnabled&&['OWNER','ADMIN','SUPERVISOR','LOGISTICS'].includes(role))review.push(['ERP 驗收待處理','僅顯示已啟用 ERP 驗收的正式收貨','receiving']);
  return `<main class="home-page">
    <section class="home-intro"><div><span class="eyebrow">今日首頁</span><h1>${escapeHtml(content.heading)}</h1><p>${escapeHtml(content.intro)}</p></div></section>
    <section class="section"><div class="section-head"><h2>今日重點</h2><span>正式 Supabase</span></div><div class="card highlight-list">${content.highlights.map(([title,copy,feature])=>`<button class="highlight-row" data-feature="${feature}"><span class="attention-dot"></span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></span><b>›</b></button>`).join('')}</div></section>
    <section class="section"><div class="section-head"><h2>每日作業</h2><span>依角色開放</span></div><div class="card work-list">${workRows(dailyWork)}</div></section>
    <section class="section"><div class="section-head"><h2>需要處理</h2><span>異常優先</span></div><div class="card review-list">${review.map(([title,copy,feature])=>`<button class="review-row" data-feature="${feature}"><span class="review-icon">!</span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></span><b>›</b></button>`).join('')}</div></section>
    <div class="build-state"><strong>PantryFlow｜系統建置狀態</strong><br>沒有正式資料時維持空狀態；不會載入 mock、seed 或 localStorage。</div>
  </main>`;
}
