import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchLoginLogs } from '../api.js';
import Pagination from '../components/Pagination.jsx';
import PageToolbar from '../components/PageToolbar.jsx';

const FAIL_REASONS = {
  no_user: 'Email no existe',
  invalid_credentials: 'Contraseña incorrecta',
  inactive: 'Cuenta desactivada',
};

const ROLE_LABELS = { admin: 'Admin', cashier: 'Cajero', worker: 'Trabajador', customer: 'Cliente' };

// Resume el user-agent a un nombre de navegador/SO legible
function parseUserAgent(ua) {
  if (!ua) return '-';
  let browser = 'Navegador';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  let os = '';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iOS/.test(ua)) os = 'iOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return os ? `${browser} · ${os}` : browser;
}

export default function LoginLogs({ token }) {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState(''); // '', 'true', 'false'
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ page: 0, totalPages: 1, hasPrevPage: false, hasNextPage: false });
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data, meta } = await fetchLoginLogs(token, {
        page: currentPage - 1, size: 50, success: filter,
      });
      setLogs(data);
      setMeta(meta);
    } catch (e) {
      setError(e.error || 'No se pudieron cargar los accesos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token, filter, currentPage]);

  return (
    <div>
      <PageToolbar title="Accesos" />

      <div className="uk-card uk-card-default uk-card-body">
        <div className="uk-margin-bottom uk-flex uk-flex-middle" style={{ gap: 8 }}>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Filtrar:</span>
          {[
            { v: '', label: 'Todos' },
            { v: 'true', label: 'Correctos' },
            { v: 'false', label: 'Fallidos' },
          ].map(opt => (
            <button
              key={opt.v}
              className={`uk-button uk-button-small ${filter === opt.v ? 'uk-button-primary' : 'uk-button-default'}`}
              onClick={() => { setFilter(opt.v); setCurrentPage(1); }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {error && <div className="uk-alert-danger" uk-alert="true"><p>{error}</p></div>}

        {loading ? (
          <div className="uk-text-center uk-padding">
            <div uk-spinner="ratio: 1"></div>
            <p>Cargando accesos...</p>
          </div>
        ) : (
          <>
            <div className="uk-overflow-auto">
              <table className="uk-table uk-table-divider uk-table-middle uk-table-small uk-table-hover" style={{ minWidth: 700 }}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Usuario</th>
                    <th>Resultado</th>
                    <th>IP</th>
                    <th>Dispositivo</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(l => (
                    <tr
                      key={l.id}
                      style={{ cursor: l.userId ? 'pointer' : 'default' }}
                      onClick={() => l.userId && navigate(`/usuarios/${l.userId}`)}
                    >
                      <td style={{ fontSize: '0.8rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                        {l.createdAt ? new Date(l.createdAt).toLocaleDateString('es-ES', { dateStyle: 'medium' }) : '-'}
                        <div style={{ fontSize: '0.7rem' }}>
                          {l.createdAt ? new Date(l.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : ''}
                        </div>
                      </td>
                      <td style={{ fontSize: '0.85rem' }}>
                        {l.user ? (
                          <>
                            <div style={{ fontWeight: 500 }}>{l.user.firstName} {l.user.lastName}</div>
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                              {ROLE_LABELS[l.user.role] || l.user.role} · {l.user.email || l.email || '-'}
                            </div>
                          </>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>{l.email || 'Desconocido'}</span>
                        )}
                      </td>
                      <td>
                        <span className={`uk-label ${l.success ? 'uk-label-success' : 'uk-label-danger'}`} style={{ fontSize: '0.6rem' }}>
                          {l.success ? 'Correcto' : (FAIL_REASONS[l.reason] || 'Fallido')}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: '#475569' }}>{l.ip || '-'}</td>
                      <td style={{ fontSize: '0.78rem', color: '#475569' }} title={l.userAgent || ''}>
                        {parseUserAgent(l.userAgent)}
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr><td colSpan="5" className="uk-text-center uk-text-muted">No hay accesos registrados.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {meta.totalPages > 1 && (
              <Pagination meta={meta} onPageChange={page => setCurrentPage(page)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

