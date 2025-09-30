import React, {useCallback, useEffect, useState} from 'react';
import {fetchOrders, facturarPedido as apiFacturarPedido} from '../api.js';
import {useNavigate} from 'react-router-dom';

function getPrimerDiaMes() {
    const hoy = new Date();
    return hoy.toISOString().slice(0, 8) + '01';
}

function getUltimoDiaMes() {
    const hoy = new Date();
    const ultimo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
    const year = ultimo.getFullYear();
    const month = String(ultimo.getMonth() + 1).padStart(2, '0');
    const day = String(ultimo.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}


const eur = new Intl.NumberFormat('es-ES', {style: 'currency', currency: 'EUR'});

export default function Ventas({token}) {
    const [fechaInicio, setFechaInicio] = useState(() => localStorage.getItem('ventas_fechaInicio') || getPrimerDiaMes());
    const [fechaFin, setFechaFin] = useState(() => localStorage.getItem('ventas_fechaFin') || getUltimoDiaMes());


    const [ventas, setVentas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedOrders, setSelectedOrders] = useState([]);
    const [selectionCriteria, setSelectionCriteria] = useState(null);

    // Al cambiar las fechas
    const handleFechaInicio = (e) => {
        setFechaInicio(e.target.value);
        localStorage.setItem('ventas_fechaInicio', e.target.value);
    };
    const handleFechaFin = (e) => {
        setFechaFin(e.target.value);
        localStorage.setItem('ventas_fechaFin', e.target.value);
    };

    const navigate = useNavigate();

    const verPedido = (o) => {
        navigate('/tareas', {
            state: {
                filterOrderId: o.id, orderNumber: o.orderNum || o.id
            }
        });
    };

    // Buscar ventas por rango de fechas usando fetchOrders
    const fetchVentas = useCallback(async () => {
        setLoading(true);
        try {
            const params = {};
            if (fechaInicio) params.startDate = fechaInicio;
            if (fechaFin) params.endDate = fechaFin;
            const data = await fetchOrders(token, params);
            setVentas(Array.isArray(data) ? data : []);
            console.log('Ventas:', data);
        } catch (err) {
            console.error('Error al cargar ventas:', err);
        } finally {
            setLoading(false);
        }
    }, [fechaInicio, fechaFin]);

// Calcula KPIs
    const totalVentas = ventas.reduce((sum, v) => sum + (Number(v.total) || 0), 0);
    const cantidadPedidos = ventas.length;
    const pedidosPendientes = ventas.filter(v => !(v.paid === false)).length;
    const pedidosFacturados = ventas.filter(v => (v.facturado === true)).length;


    useEffect(() => {
        fetchVentas();
    }, [fetchVentas]);

    // Facturar pedido usando api.js
    const facturarPedido = async (orderId, yaFacturado) => {
        if (yaFacturado) return; // nada que hacer
        const confirmar = window.confirm('¿Generar factura para este pedido?');
        if (!confirmar) return;

        setLoading(true);
        try {
            await apiFacturarPedido(orderId);
            await fetchVentas(); // refrescar ventas
        } catch (err) {
            alert('Error al facturar pedido');
        } finally {
            setLoading(false);
        }
    };

    // Función para manejar la selección de pedidos
    const handleSelectOrder = (order) => {
        const isSelected = selectedOrders.includes(order.id);
        let newSelectedOrders;
        if (isSelected) {
            newSelectedOrders = selectedOrders.filter(id => id !== order.id);
        } else {
            newSelectedOrders = [...selectedOrders, order.id];
        }
        if (newSelectedOrders.length === 0) {
            setSelectionCriteria(null);
        } else if (!isSelected && newSelectedOrders.length === 1) {
            setSelectionCriteria({
                clientId: order.client?.id,
                paid: order.paid
            });
        }
        setSelectedOrders(newSelectedOrders);
    };

    const canSelectOrder = (order) => {
        if (order.facturado) return false;
        if (!selectionCriteria) return true;
        return (
            order.client?.id === selectionCriteria.clientId &&
            order.paid === selectionCriteria.paid
        );
    };

    return (<div>
        <div className="section-header">
            <h2 className="uk-margin-remove">Ventas</h2>

            <div className="uk-button-group">
                <button
                    className="uk-button uk-button-default"
                    onClick={() => {
                        fetchVentas();
                    }}
                    type="button"
                >
                    Todos
                </button>
                <button
                    className="uk-button uk-button-default"
                    onClick={() => {
                        setVentas(ventas.filter(v => (v.paid === false)));
                    }}
                    type="button"
                >
                    Pendientes
                </button>
                <button
                    className="uk-button uk-button-default"
                    onClick={() => {
                        setVentas(ventas.filter(v => v.paid === true));
                    }}
                    type="button"
                >
                    Pagados
                </button>
            </div>

        </div>
        <div className="uk-grid uk-padding uk-child-width-1-4 uk-grid-small uk-margin-bottom">
            <div>
                <div className="uk-card uk-card-default uk-card-body uk-text-center">
                    <div className="uk-text-bold">Total</div>
                    <div className="uk-text-large">{eur.format(totalVentas)}</div>
                </div>
            </div>
            <div>
                <div className="uk-card uk-card-default uk-card-body uk-text-center">
                    <div className="uk-text-bold">Pedidos</div>
                    <div className="uk-text-large">{cantidadPedidos}</div>
                </div>
            </div>
            <div>
                <div className="uk-card uk-card-default uk-card-body uk-text-center">
                    <div className="uk-text-bold">Pendientes</div>
                    <div className="uk-text-large">{pedidosPendientes}</div>
                </div>
            </div>
            <div>
                <div className="uk-card uk-card-default uk-card-body uk-text-center">
                    <div className="uk-text-bold">Facturados</div>
                    <div className="uk-text-large">{pedidosFacturados}</div>
                </div>
            </div>
        </div>
        <div className="uk-card uk-card-default uk-card-body">

            <form className="uk-form-stacked uk-grid-small uk-flex-middle" uk-grid="true">
                <div>
                    <label className="uk-form-label">Desde:</label>
                    <input
                        className="uk-input"
                        type="date"
                        value={fechaInicio}
                        onChange={handleFechaInicio}
                    />
                </div>
                <div>
                    <label className="uk-form-label">Hasta:</label>
                    <input
                        className="uk-input"
                        type="date"
                        value={fechaFin}
                        onChange={handleFechaFin}
                    />
                </div>
            </form>

            {loading ? (<div className="uk-text-center uk-margin">
                <span className="uk-badge uk-badge-warning">Cargando ventas...</span>
            </div>) : ventas.length === 0 ? (<div className="uk-text-center uk-margin">
                <span className="uk-badge uk-badge-muted">No hay ventas en el rango seleccionado.</span>
            </div>) : (<table className="uk-table uk-table-divider uk-table-small">
                <thead>
                <tr>
                    <th>
                        <input
                            type="checkbox"
                            checked={selectedOrders.length > 0 && ventas.filter(v => canSelectOrder(v)).every(v => selectedOrders.includes(v.id))}
                            onChange={e => {
                                if (e.target.checked) {
                                    const validIds = ventas.filter(v => canSelectOrder(v)).map(v => v.id);
                                    setSelectedOrders(validIds);
                                    if (validIds.length > 0) {
                                        const first = ventas.find(v => v.id === validIds[0]);
                                        setSelectionCriteria({
                                            clientId: first.client?.id,
                                            paid: first.paid
                                        });
                                    }
                                } else {
                                    setSelectedOrders([]);
                                    setSelectionCriteria(null);
                                }
                            }}
                        />
                    </th>
                    <th>Número</th>
                    <th>Fecha</th>
                    <th>Cliente</th>
                    <th>Total</th>
                    <th>Estado</th>
                    <th>Factura</th>
                    <th></th>
                </tr>
                </thead>
                <tbody>
                {ventas.map((v) => {
                    const fecha = v.createdAt ? new Date(v.createdAt).toLocaleDateString('es-ES', {dateStyle: 'medium'}) : '-';
                    const cliente = v.client?.denominacionSocial || v.client?.firstName + ' ' + v.client.lastName || v.cliente || '-';
                    const total = typeof v.total === 'number' ? eur.format(v.total) : v.total ? eur.format(Number(v.total)) : '-';
                    const yaFacturado = v.status === 'collected' || Boolean(v.facturado);

                    return (<tr key={v.id} className={yaFacturado ? 'estado-facturado' : 'estado-pendiente'}>
                        <td>
                            <input
                                type="checkbox"
                                checked={selectedOrders.includes(v.id)}
                                disabled={!canSelectOrder(v)}
                                onChange={() => handleSelectOrder(v)}
                            />
                        </td>
                        <td>{v.orderNum}</td>
                        <td>{fecha}</td>
                        <td>{cliente}</td>
                        <td>{total}</td>
                        <td>
                                        <span
                                            className={`uk-badge ${yaFacturado ? 'uk-badge-success' : 'uk-badge-warning'}`}>
                                            {yaFacturado ? 'Facturado' : 'Pendiente'}
                                        </span>
                        </td>
                        <td>
                            <button
                                className="uk-button uk-button-default uk-button-small"
                                onClick={() => facturarPedido(v.id, yaFacturado)}
                                disabled={yaFacturado || loading}
                                title={yaFacturado ? 'Este pedido ya está facturado' : 'Generar factura'}
                            >
                                {yaFacturado ? '—' : 'Facturar'}
                            </button>
                        </td>
                        <td>
                            <button
                                className="uk-button uk-button-primary uk-button-small"
                                onClick={() => verPedido(v)}
                                title="Ver tareas de este pedido"
                            >
                                Ver pedido
                            </button>
                        </td>
                    </tr>);
                })}
                </tbody>
            </table>)}
        </div>
    </div>);
}
