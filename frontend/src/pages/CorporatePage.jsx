import React from 'react';
import { useParams } from 'react-router-dom';
import { CorporateDebts } from '../components/CorporateDebts/CorporateDebts.jsx';
import { CorporateEntity } from '../components/CorporateDebts/CorporateEntity.jsx';

export default function CorporatePage() {
  const { entityId } = useParams();
  if (entityId) return <CorporateEntity entityId={entityId} />;
  return <CorporateDebts />;
}
