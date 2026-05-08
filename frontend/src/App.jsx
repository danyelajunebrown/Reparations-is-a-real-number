import React, { Suspense, lazy } from 'react';
import { Routes, Route, NavLink, Link, useLocation } from 'react-router-dom';

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
const DepositorsPage = lazy(() => import('./pages/DepositorsPage.jsx'));

export default function App() {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className="app">
      <header className="app-header">
        {/* On the home page, the title lives in the page body (Google-style).
            On all other pages, show the full title + subtitle in the header. */}
        {!isHome && (
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <h1 className="app-title">Reparations ∈ ℝ</h1>
            <div className="app-subtitle">
              A global slavery accountability infrastructure.
              Every person displayed here is verified against primary sources.
            </div>
          </Link>
        )}
        <nav className="app-nav">
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/search">Search</NavLink>
          <NavLink to="/depositors">Depositors</NavLink>
          <NavLink to="/lineage">Lineages</NavLink>
          <NavLink to="/documents">Documents</NavLink>
          <NavLink to="/corporate">Corporate Debts</NavLink>
          <NavLink to="/legal">Legal Framework</NavLink>
          <NavLink to="/pay">Payment</NavLink>
          <NavLink to="/admin">Admin</NavLink>
        </nav>
      </header>

      <main>
        <Suspense fallback={<div className="state">Loading<span className="blink">_</span></div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/depositors" element={<DepositorsPage />} />
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
          <a
            href="https://github.com/danyelajunebrown/Reparations-is-a-real-number"
            target="_blank"
            rel="noopener noreferrer"
          >
            Source on GitHub
          </a>
          {' — '}Every line open for collaboration.
        </div>
      </footer>
    </div>
  );
}
