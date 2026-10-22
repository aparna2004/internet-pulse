import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import {MotionConfig} from 'framer-motion';
import './style.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><MotionConfig reducedMotion="user"><App/></MotionConfig></React.StrictMode>);
