import React, { Suspense, lazy } from 'react';
import { Routes, Route, NavLink, Link } from 'react-router-dom';
import { StatsRibbon } from './components/Layout/StatsRibbon.jsx';

// Lazy load heavy panels so the initial bundle stays small.
const HomePage = lazy(() => import('./pages/HomePage.jsx'));
const SearchPage = lazy(() => import('./pages/SearchPage.jsx'));
const PersonPage = lazy(() => import('./pages/PersonPage.jsx'));
const LineagePage = lazy(() => import('./pages/LineagePage.jsx'));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage.jsx'));
const CorporatePage = lazy(() => import('./pages/CorporatePage.jsx'));
const LegalPage = lazy(() => import('./pages/LegalPage.jsx'));
const BlockchainPage = lazy(() => import('./pages/BlockchainPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h1 className="app-title">Reparations ∈ ℝ</h1>
          <div className="app-subtitle">
            A global slavery accountability infrastructure.
            Every person displayed here is verified against primary sources.
          </div>
        </Link>
        <nav className="app-nav">
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/lineage">Lineages</NavLink>
          <NavLink to="/documents">Documents</NavLink>
          <NavLink to="/corporate">Corporate Debts</NavLink>
          <NavLink to="/legal">Legal Framework</NavLink>
          <NavLink to="/pay">Payment</NavLink>
          <NavLink to="/admin">Admin</NavLink>
        </nav>
        <StatsRibbon />
      </header>

      <main>
        <Suspense fallback={<div className="state">Loading<span className="blink">_</span></div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/person/:source/:id" element={<PersonPage />} />
            <Route path="/lineage" element={<LineagePage />} />
            <Route path="/lineage/:sessionId" element={<LineagePage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/documents/:id" element={<DocumentsPage />} />
            <Route path="/corporate" element={<CorporatePage />} />
            <Route path="/corporate/:entityId" element={<CorporatePage />} />
            <Route path="/legal" element={<LegalPage />} />
            <Route path="/legal/:topic" element={<LegalPage />} />
            <Route path="/pay" element={<BlockchainPage />} />
            <Route path="/admin/*" element={<AdminPage />} />
            <Route path="*" element={<div className="state err">404 — path not found</div>} />
          </Routes>
        </Suspense>
      </main>

      <footer className="app-footer">
        <div>
          Built for the May 2026 premiere. This is a proof-of-concept for a
          living, globally-aware accountability system — not the product.
        </div>
        <div style={{ marginTop: 8 }}>
          Source on GitHub. Every line open for collaboration.
        </div>
      </footer>
    </div>
  );
}
