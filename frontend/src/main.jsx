import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

import UIkit from 'uikit';
import Icons from 'uikit/dist/js/uikit-icons';
import './styles/uikit-theme.less'; // importa TU build con variables

UIkit.use(Icons);


createRoot(document.getElementById('root')).render(
    <BrowserRouter>
        <App />
    </BrowserRouter>
);
