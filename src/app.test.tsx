// @vitest-environment jsdom

import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {App,Provider} from './main';
import {seed} from './domain';

describe('reservation UI flow',()=>{
  beforeEach(()=>localStorage.clear());
  afterEach(()=>cleanup());
  it('books the selected plate, charges RM4, and persists the active reservation',async()=>{
    render(<MemoryRouter initialEntries={['/my-parking']}><Provider><App/></Provider></MemoryRouter>);
    expect(screen.getByText('No active parking')).toBeDefined();
    fireEvent.click(screen.getAllByRole('link',{name:'Reserve'})[0]);
    fireEvent.click(screen.getByRole('button',{name:/WXY 1234/}));
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect(screen.getByText('RM 10.00')).toBeDefined();
    fireEvent.click(screen.getByRole('button',{name:/Continue to payment/}));
    fireEvent.click(screen.getByRole('button',{name:/Confirm reservation/}));
    await waitFor(()=>expect(screen.getByText('Reservation active')).toBeDefined(),{timeout:2000});
    const saved=JSON.parse(localStorage.getItem('parkease:mvp1:v1')??'{}');
    expect(saved.wallet).toBe(4600);
    expect(saved.reservations[0].plate).toBe('WXY 1234');
    expect(saved.reservations[0].status).toBe('active');
  });
  it('persists theme and notification read state across a remount',async()=>{
    const state=seed();state.notices=[{id:'notice-demo',at:state.now,title:'Reservation confirmed',message:'A demo reservation is ready.',read:false}];localStorage.setItem('parkease:mvp1:v1',JSON.stringify(state));
    const view=render(<MemoryRouter initialEntries={['/profile']}><Provider><App/></Provider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button',{name:'Toggle theme'}));
    await waitFor(()=>expect(JSON.parse(localStorage.getItem('parkease:mvp1:v1')??'{}').theme).toBe('dark'));
    fireEvent.click(screen.getByRole('button',{name:'Notifications'}));
    fireEvent.click(screen.getByRole('button',{name:/Reservation confirmed/}));
    await waitFor(()=>expect(JSON.parse(localStorage.getItem('parkease:mvp1:v1')??'{}').notices[0].read).toBe(true));
    view.unmount();const remounted=render(<MemoryRouter initialEntries={['/profile']}><Provider><App/></Provider></MemoryRouter>);
    expect(remounted.container.querySelector('.app')?.className).toContain('dark');
    fireEvent.click(screen.getByRole('button',{name:'Notifications'}));
    expect(screen.getByRole('button',{name:/Reservation confirmed/}).className).toContain('read');
  });
  it('reset restores the seeded baseline and persisted light theme',async()=>{
    const state=seed();state.wallet=900;state.theme='dark';state.bgWalk=150;localStorage.setItem('parkease:mvp1:v1',JSON.stringify(state));
    render(<MemoryRouter initialEntries={['/demo']}><Provider><App/></Provider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button',{name:/Reset all demo data/}));
    fireEvent.click(screen.getByRole('button',{name:'Reset all data'}));
    await waitFor(()=>expect(JSON.parse(localStorage.getItem('parkease:mvp1:v1')??'{}').wallet).toBe(5000));
    const reset=JSON.parse(localStorage.getItem('parkease:mvp1:v1')??'{}');expect(reset.theme).toBe('light');expect(reset.bgReserved).toBe(30);expect(reset.bgWalk).toBe(110);expect(reset.bgHolds).toBe(13);expect(reset.reservations).toHaveLength(0);expect(reset.sessions).toHaveLength(0);
  });
  it('updates the mounted UI from a validated storage event without reloading',async()=>{
    const view=render(<MemoryRouter initialEntries={['/profile']}><Provider><App/></Provider></MemoryRouter>);
    const state=seed();state.wallet=6200;localStorage.setItem('parkease:mvp1:v1',JSON.stringify(state));
    fireEvent(window,new StorageEvent('storage',{key:'parkease:mvp1:v1',newValue:JSON.stringify(state)}));
    await waitFor(()=>expect(view.container.textContent).toContain('RM 62.00'));
    expect(view.container.querySelector('.app')).not.toBeNull();
  });
});
