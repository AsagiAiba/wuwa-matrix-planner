import demo from '../tests/fixtures/demo.json' with {type:'json'};
import alternate from '../tests/fixtures/alternate-demo.json' with {type:'json'};

// Isolated browser test contexts start with known data when a scenario exercises populated teams.
export async function seedTestPlans(page) {
  await page.addInitScript(([base,alt])=>{
    if(window!==window.top)return;
    const key='wuwa-matrix-plan-library-v1';
    if(localStorage.getItem(key) || sessionStorage.getItem('matrix-test-plans-seeded'))return;
    sessionStorage.setItem('matrix-test-plans-seeded','1');
    const previous=localStorage.getItem('wuwa-matrix-demo-v1');
    const plans=[{id:'plan-main',name:'我的排布',config:previous?JSON.parse(previous):base},{id:'plan-demo-b',name:'示例B · 椿丹白先手',config:alt}];
    localStorage.setItem(key+'-unseeded-052','1');
    localStorage.setItem(key,JSON.stringify({version:1,activePlanId:'plan-main',plans}));
  },[demo,alternate]);
}
export async function resetTestPlan(page){
  await page.evaluate(base=>{
    const key='wuwa-matrix-plan-library-v1',library=JSON.parse(localStorage.getItem(key));
    library.plans.find(p=>p.id===library.activePlanId).config=base;
    localStorage.setItem(key,JSON.stringify(library));localStorage.setItem('wuwa-matrix-demo-v1',JSON.stringify(base));
  },demo);
  await page.reload();await page.locator('.team-bar').first().waitFor();
}
