import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {Provider} from './state/store';
import {App} from './App';
import {AuthProvider} from './auth';
export {App} from './App';
export {Provider,useStore} from './state/store';
import './style.css';

const rootElement=document.getElementById('root');
if(rootElement)createRoot(rootElement).render(<React.StrictMode><BrowserRouter><AuthProvider><Provider><App/></Provider></AuthProvider></BrowserRouter></React.StrictMode>);
