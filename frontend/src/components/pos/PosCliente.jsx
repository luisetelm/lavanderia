import React, {useState} from 'react';
import CustomerSelector from '../CustomerSelector.jsx';
import {useDraftOrder} from '../../hooks/useDraftOrder.js';

// Bloque «Cliente» del TPV: buscar un cliente o dar de alta uno rápido.
// Lo usan la vista clásica y la vista por pasos sobre el mismo pedido en curso.
export default function PosCliente({token}) {
    const draft = useDraftOrder();
    const [searchUser, setSearchUser] = useState('');

    return (
        <section id="pos-cliente" className="uk-card uk-card-default pos-card pos-sec-cliente">
            <h4 className="pos-card-title">
                <span uk-icon="icon: user; ratio: 0.9"></span>
                Cliente
            </h4>
            <CustomerSelector
                searchUser={searchUser} setSearchUser={setSearchUser}
                selectedUser={draft.selectedUser}
                setSelectedUser={(u) => draft.setSelectedUser(u)}
                quickFirstName={draft.quickClient.firstName}
                quickLastName={draft.quickClient.lastName}
                quickClientPhone={draft.quickClient.phone}
                quickClientEmail={draft.quickClient.email}
                setQuickFirstName={(v) => draft.setQuickClient({firstName: v})}
                setQuickLastName={(v) => draft.setQuickClient({lastName: v})}
                setQuickClientPhone={(v) => draft.setQuickClient({phone: v})}
                setQuickClientEmail={(v) => draft.setQuickClient({email: v})}
                token={token}
            />
        </section>
    );
}
