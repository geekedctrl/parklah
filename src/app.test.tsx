// @vitest-environment jsdom

import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {App,Provider} from './main';
import {AuthProvider} from './auth';

const facility={id:1,name:'North Car Park',capacity:100,occupied:10,held:2,available:88,status:'open',hours:'05:00–01:00',restrictions:'',test_data:false,zones:[{id:10,name:'General',capacity:100,rate_sen:900}]};
let vehicles=[{id:1,plate:'WXY 1234',label:'My Car',is_default:true}];
let reservations:Array<{id:string;plate:string;facility:string;facility_id:number;status:string;created_at:string;expires_at:string}>=[];
let balance=5000;

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})}
function mockApi(){
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input),path=url.replace(/^.*\/api/,'');
    if(path==='/auth/refresh')return json({access_token:'test-token',user:{id:1,email:'student@sunway.edu.my',role:'user',verified:true,is_demo:false}});
    if(path==='/user/dashboard')return json({facilities:[facility],wallet_balance_sen:balance,payment_mode:'sandbox'});
    if(path==='/user/vehicles'&&(!init?.method||init.method==='GET'))return json({items:vehicles});
    if(path==='/user/parking')return json({reservations,visits:[],wallet_balance_sen:balance});
    if(path==='/user/vehicles'&&init?.method==='POST'){
      const body=JSON.parse(String(init.body));const vehicle={id:vehicles.length+1,plate:body.plate.toUpperCase(),label:body.label,is_default:body.is_default};vehicles=[...vehicles,vehicle];return json(vehicle,201);
    }
    if(path==='/user/reservations'&&init?.method==='POST'){
      const body=JSON.parse(String(init.body));balance-=400;const reservation={id:'reservation-1',plate:'WXY 1234',facility:'North Car Park',facility_id:body.facility_id,status:'active',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString()};reservations=[reservation];return json(reservation,201);
    }
    if(path==='/user/wallet/top-up'&&init?.method==='POST'){balance+=2000;return json({balance_sen:balance},201)}
    return json({detail:`Unhandled test API request: ${init?.method??'GET'} ${path}`},404);
  }));
}
class TestResizeObserver{observe(){}unobserve(){}disconnect(){}}

function renderApp(path:string){return render(<MemoryRouter initialEntries={[path]}><AuthProvider><Provider><App/></Provider></AuthProvider></MemoryRouter>)}

describe('authenticated user workspace',()=>{
  beforeEach(()=>{localStorage.clear();sessionStorage.clear();vehicles=[{id:1,plate:'WXY 1234',label:'My Car',is_default:true}];reservations=[];balance=5000;vi.stubGlobal('ResizeObserver',TestResizeObserver);mockApi()});
  afterEach(()=>{cleanup();vi.unstubAllGlobals()});

  it('loads campus availability and the account wallet from the API',async()=>{
    renderApp('/');
    await screen.findByText('AVAILABLE BAYS',{}, {timeout:5000});
    expect((await screen.findAllByText('88')).length).toBeGreaterThan(0);
    expect(screen.getByText('RM 50.00')).toBeDefined();
    expect(screen.getByText('North Car Park')).toBeDefined();
  });

  it('creates a reservation through the API and shows it in My Parking',async()=>{
    renderApp('/reserve');
    await screen.findByText('Choose a facility');
    fireEvent.change(screen.getByLabelText('Vehicle'),{target:{value:'1'}});
    fireEvent.click(screen.getByRole('button',{name:/Reserve and pay sandbox fee/}));
    await screen.findByText('Upcoming reservation');
    expect(await screen.findByText(/WXY 1234/)).toBeDefined();
    expect(screen.getByText('North Car Park',{exact:false})).toBeDefined();
    expect(balance).toBe(4600);
  });

  it('adds a vehicle to the account through the API',async()=>{
    renderApp('/profile');
    await screen.findByText('Registered vehicles');
    fireEvent.change(screen.getByLabelText('Plate'),{target:{value:'ABC 1234'}});
    fireEvent.change(screen.getByLabelText('Vehicle label'),{target:{value:'Second car'}});
    fireEvent.click(screen.getByRole('button',{name:/Add vehicle/}));
    expect(await screen.findByText('ABC 1234')).toBeDefined();
    expect(vehicles).toHaveLength(2);
  });
});
