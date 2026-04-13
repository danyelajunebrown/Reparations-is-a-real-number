import React from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { ReviewQueue } from '../components/Admin/ReviewQueue.jsx';
import { DataQuality } from '../components/Admin/DataQuality.jsx';
import { ParticipantManagement } from '../components/Admin/ParticipantManagement.jsx';
import { AdminHome } from '../components/Admin/AdminHome.jsx';
import { AdminAuth } from '../components/Admin/AdminAuth.jsx';

// Admin routes are gated by AdminAuth, which checks a token against
// /api/admin/verify. The token is set via ADMIN_TOKEN env var on the backend.
// In dev (NODE_ENV !== 'production'), the backend leaves endpoints open with
// a startup warning, so AdminAuth will pass without a real token.
export default function AdminPage() {
  return (
    <AdminAuth>
      <div className="app-nav" style={{ marginTop: 0 }}>
        <NavLink to="/admin" end>Overview</NavLink>
        <NavLink to="/admin/review">Review queue</NavLink>
        <NavLink to="/admin/quality">Data quality</NavLink>
        <NavLink to="/admin/participants">Participants</NavLink>
      </div>
      <Routes>
        <Route path="/" element={<AdminHome />} />
        <Route path="/review" element={<ReviewQueue />} />
        <Route path="/quality" element={<DataQuality />} />
        <Route path="/participants" element={<ParticipantManagement />} />
      </Routes>
    </AdminAuth>
  );
}
