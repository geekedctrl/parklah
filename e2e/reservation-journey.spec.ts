import {expect,test} from '@playwright/test';

let pageErrors:string[]=[];
test.beforeEach(({page})=>{pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));});
test.afterEach(()=>expect(pageErrors).toEqual([]));

test('a failed lazy route load shows a recovery screen instead of a blank page',async({page})=>{
  await page.route('**/*ParkingPages*',route=>route.abort());
  await page.goto('/profile',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('alert')).toContainText('This screen could not be loaded.');
  await expect(page.getByRole('button',{name:'Reload ParkEase'})).toBeVisible();
});

test('signboard shows seeded capacity and ordinary clock ticks do not create fast-forward toasts',async({page})=>{
  await page.goto('/signboard',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.sign-number')).toHaveText('147');
  await expect(page.getByText('Vehicles inside')).toBeVisible();
  await page.goto('/demo',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:'Demo control panel'})).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(page.getByText(/^Advanced .* minutes\.$/)).toHaveCount(0);
});

test('home chart distinguishes simulated history and refreshes the live timestamp',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:"Today's occupancy"})).toBeVisible();
  await expect(page.getByText('DEMO DATA',{exact:true})).toBeVisible();
  await expect(page.getByText('current hour uses live demo occupancy')).toBeVisible();
  await expect(page.getByText('NOW',{exact:true})).toBeVisible();
  const refreshed=page.locator('.float-card.float-a small');
  const initial=await refreshed.textContent();
  await expect.poll(async()=>refreshed.textContent(),{timeout:7000}).not.toBe(initial);
  await expect(page.locator('.hero-tag')).toHaveClass(/refreshed/);
});

test('reserved plate is matched at entry and checkout charges RM6 once',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.getByText('147 bays',{exact:false}).first()).toBeVisible();
  await page.getByRole('link',{name:/Reserve/}).first().click();
  await page.getByRole('button',{name:/WXY 1234/}).click();
  await page.getByRole('button',{name:'Continue'}).click();
  await expect(page.getByText('RM 10.00')).toBeVisible();
  await expect(page.getByText('Current availability')).toBeVisible();
  await expect(page.getByText('Reserved pool left')).toBeVisible();
  await expect(page.getByText('Booking time · Malaysia time').locator('..')).toContainText('MYT');
  await expect(page.getByText('Arrive before · Malaysia time').locator('..')).toContainText('MYT');
  await page.getByRole('button',{name:/Continue to payment/}).click();
  await page.getByRole('button',{name:/Confirm reservation/}).click();
  const pending=page.getByRole('button',{name:/Processing reservation/});
  await expect(pending).toBeDisabled();
  await expect(page.getByText('Reservation active')).toBeVisible();
  await expect(page.locator('.reservation-state').getByText('RM 4.00')).toBeVisible();
  await expect.poll(async()=>JSON.parse(await page.evaluate(()=>localStorage.getItem('parkease:mvp1:v1')||'{}')).wallet).toBe(4600);
  await page.getByRole('link',{name:'My Parking'}).first().click();
  await expect(page.getByText('TIME LEFT TO ARRIVE')).toBeVisible();
  await page.getByRole('button',{name:/Open demo controls/}).click();
  await page.getByRole('button',{name:/\+45/}).click();
  await page.getByRole('button',{name:'Notifications'}).click();
  await expect(page.getByRole('button',{name:/Reservation · 15 minutes left/})).toBeVisible();
  await page.getByRole('button',{name:'Notifications'}).click();
  await page.getByRole('button',{name:/Simulate automatic reserved entry/}).click();
  await expect(page.getByRole('heading',{name:'Plate recognised'})).toBeVisible();
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:'Plate recognised'})).toBeVisible();
  await expect(page.getByRole('heading',{name:/successfully entered the basement/})).toBeVisible({timeout:12_000});
  await expect(page.getByText('Currently parked')).toBeVisible();
  await expect(page.getByText('WXY 1234').first()).toBeVisible();
  await page.getByRole('button',{name:/Check out/}).click();
  await expect(page.getByRole('heading',{name:'Review your checkout'})).toBeVisible();
  await expect(page.getByText('Entry time · Malaysia time')).toBeVisible();
  await expect(page.getByText('Exit time preview · Malaysia time')).toBeVisible();
  await expect(page.getByText('Elapsed duration')).toBeVisible();
  await expect(page.getByText('Parking day rate').first()).toBeVisible();
  await expect(page.getByText('Amount due now').locator('..')).toContainText('RM 6.00');
  await page.getByRole('button',{name:/Pay and check out/}).click();
  await expect(page.getByText('Checkout complete',{exact:true})).toBeVisible();
  await expect(page.getByText('Total parking cost').locator('..')).toContainText('RM 10.00');
  await expect(page.getByText(/Wallet balance/)).toContainText('RM 40.00');
  await expect.poll(async()=>JSON.parse(await page.evaluate(()=>localStorage.getItem('parkease:mvp1:v1')||'{}')).wallet).toBe(4000);
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('parkease:mvp1:v1')||'{}'));
  expect(state.reservations.some((r:{status:string})=>r.status==='completed')).toBe(true);
  expect(state.sessions.some((s:{status:string;plate:string})=>s.status==='completed'&&s.plate==='WXY 1234')).toBe(true);
});

test('expired reservation refunds RM4 and releases its held bay',async({page})=>{
  await page.goto('/reserve',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:/WXY 1234/}).click();
  await page.getByRole('button',{name:'Continue'}).click();
  await page.getByRole('button',{name:/Continue to payment/}).click();
  await page.getByRole('button',{name:/Confirm reservation/}).click();
  await expect(page.getByText('Reservation active')).toBeVisible();
  await page.getByRole('button',{name:/Open demo controls/}).click();
  await page.getByRole('button',{name:/Trigger reservation expiry/}).click();
  await expect(page.getByText('No active booking',{exact:true}).first()).toBeVisible();
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('parkease:mvp1:v1')||'{}'));
  expect(state.wallet).toBe(5000);
  expect(state.reservations[0].status).toBe('expired');
  expect(state.transactions.filter((tx:{type:string})=>tx.type==='reservationRefund')).toHaveLength(1);
  await page.getByRole('link',{name:'My Parking'}).first().click();
  await expect(page.getByText('Reservation expired')).toBeVisible();
});

test('insufficient checkout funds keep the vehicle parked and the review open',async({page})=>{
  await page.goto('/reserve',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
    const key='parkease:mvp1:v1';
    const state=JSON.parse(localStorage.getItem(key)||'{}');
    state.wallet=500;
    const opening=state.transactions.find((transaction:{type:string})=>transaction.type==='initialCredit');
    if(opening)opening.amount=500;
    const value=JSON.stringify(state);
    localStorage.setItem(key,value);
    window.dispatchEvent(new StorageEvent('storage',{key,newValue:value}));
  });
  await page.getByRole('button',{name:/WXY 1234/}).click();
  await page.getByRole('button',{name:'Continue'}).click();
  await page.getByRole('button',{name:/Continue to payment/}).click();
  await page.getByRole('button',{name:/Confirm reservation/}).click();
  await expect(page.getByText('Reservation active')).toBeVisible();
  await page.getByRole('button',{name:/Open demo controls/}).click();
  await page.getByRole('button',{name:/Simulate automatic reserved entry/}).click();
  await expect(page.getByRole('heading',{name:/successfully entered the basement/})).toBeVisible({timeout:12_000});
  await expect(page.getByText('Currently parked')).toBeVisible();
  await page.getByRole('button',{name:/Check out/}).click();
  await page.getByRole('button',{name:/Pay and check out/}).click();
  await expect(page.getByRole('heading',{name:'Review your checkout'})).toBeVisible();
  await expect(page.getByText(/Insufficient wallet balance/)).toBeVisible();
  const afterRejected=await page.evaluate(()=>JSON.parse(localStorage.getItem('parkease:mvp1:v1')||'{}'));
  expect(afterRejected.wallet).toBe(100);
  expect(afterRejected.sessions.some((s:{status:string})=>s.status==='active')).toBe(true);
  await page.getByRole('button',{name:/Add RM20 demo funds/}).click();
  await page.getByRole('button',{name:/Pay and check out/}).click();
  await expect(page.getByText('Checkout complete',{exact:true})).toBeVisible();
  const afterPaid=await page.evaluate(()=>JSON.parse(localStorage.getItem('parkease:mvp1:v1')||'{}'));
  expect(afterPaid.wallet).toBe(1500);
  expect(afterPaid.sessions.some((s:{status:string})=>s.status==='completed')).toBe(true);
});

test('reservation payment is unavailable during campus closing hours',async({page})=>{
  await page.goto('/demo',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Set to 12:59 AM'}).click();
  await page.getByRole('button',{name:/\+1 min/}).click();
  await expect(page.getByText('Campus closed',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Home'}).first().click();
  await expect(page.getByRole('button',{name:/Reserve a bay/}).first()).toBeDisabled();
  await expect(page.getByText('Reservations reopen at 5:00 AM.')).toBeVisible();
  await page.getByRole('link',{name:'Reserve'}).first().click();
  await page.getByRole('button',{name:/WXY 1234/}).click();
  await page.getByRole('button',{name:'Continue'}).click();
  await page.getByRole('button',{name:/Continue to payment/}).click();
  await expect(page.getByText(/Reservations are unavailable while ParkEase is closed/)).toBeVisible();
  await expect(page.getByRole('button',{name:/Confirm reservation/})).toBeDisabled();
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('parkease:mvp1:v1')||'{}'));
  expect(state.wallet).toBe(5000);
  expect(state.reservations).toHaveLength(0);
});

test('mobile navigation remains usable at 360px without horizontal overflow',async({page})=>{
  await page.setViewportSize({width:360,height:800});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{name:/Good (morning|afternoon|evening), Alex/})).toBeVisible();
  const touchTargets=await page.evaluate(()=>({primary:document.querySelector('.hero-buttons .btn')?.getBoundingClientRect().height??0,headerControls:Array.from(document.querySelectorAll('.topbar .icon-btn')).map(el=>el.getBoundingClientRect().height),tabs:Array.from(document.querySelectorAll('.bottom-nav a')).map(el=>el.getBoundingClientRect().height)}));
  expect(touchTargets.primary).toBeGreaterThanOrEqual(44);
  expect(touchTargets.headerControls.every(height=>height>=44)).toBe(true);
  expect(touchTargets.tabs.every(height=>height>=44)).toBe(true);
  for(const name of ['Reserve','My Parking','Activity','Profile']){
    await page.getByRole('navigation').getByRole('link',{name}).click();
    await expect(page.getByRole('main')).toBeVisible();
  }
  const widths=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client+1);
});

test('notification preference persists and pauses generated notices only',async({page})=>{
  await page.goto('/profile',{waitUntil:'domcontentloaded'});
  const preference=page.getByRole('switch',{name:'Parking notifications'});
  await expect(preference).toHaveAttribute('aria-checked','true');
  await preference.click();
  await expect(preference).toHaveAttribute('aria-checked','false');
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.getByRole('switch',{name:'Parking notifications'})).toHaveAttribute('aria-checked','false');
  await page.getByRole('link',{name:'Reserve'}).first().click();
  await page.getByRole('button',{name:/WXY 1234/}).click();
  await page.getByRole('button',{name:'Continue'}).click();
  await page.getByRole('button',{name:/Continue to payment/}).click();
  await page.getByRole('button',{name:/Confirm reservation/}).click();
  await expect(page.getByText('Reservation active')).toBeVisible();
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('parkease:mvp1:v1')||'{}'));
  expect(state.wallet).toBe(4600);
  expect(state.notices).toHaveLength(0);
  expect(state.notificationsEnabled).toBe(false);
});

test('vehicle dialog keeps inline validation visible and saves normalized plates',async({page})=>{
  await page.goto('/profile',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Add vehicle'}).click();
  const dialog=page.getByRole('dialog',{name:'Add a vehicle'});
  await page.getByRole('textbox',{name:'Registration plate'}).fill('@@@');
  await page.getByRole('button',{name:'Save vehicle'}).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Enter a valid plate using letters and numbers.');
  await expect(page.getByRole('textbox',{name:'Registration plate'})).toHaveAttribute('aria-invalid','true');
  await page.getByRole('textbox',{name:'Registration plate'}).fill('wxy1234');
  await page.getByRole('button',{name:'Save vehicle'}).click();
  await expect(page.getByRole('alert')).toHaveText('That plate is already saved.');
  await page.getByRole('textbox',{name:'Registration plate'}).fill('abc1234');
  await page.getByRole('textbox',{name:'Vehicle nickname'}).fill('Second car');
  await page.getByRole('button',{name:'Save vehicle'}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('ABC1234',{exact:true})).toBeVisible();
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('parkease:mvp1:v1')||'{}'));
  expect(state.vehicles.some((v:{plate:string;label:string})=>v.plate==='ABC1234'&&v.label==='Second car')).toBe(true);
});

test('another open tab receives wallet updates without a page reload',async({page,context})=>{
  await page.goto('/profile',{waitUntil:'domcontentloaded'});
  await expect(page.locator('.wallet-card h2')).toHaveText('RM 50.00');
  const originalTimeOrigin=await page.evaluate(()=>performance.timeOrigin);
  const second=await context.newPage();
  await second.goto('/profile',{waitUntil:'domcontentloaded'});
  await second.getByRole('button',{name:/Top up RM 20\.00/}).click();
  await expect(page.locator('.wallet-card h2')).toHaveText('RM 70.00');
  expect(await page.evaluate(()=>performance.timeOrigin)).toBe(originalTimeOrigin);
});
