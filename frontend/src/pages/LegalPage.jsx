import React from 'react';
import { useParams } from 'react-router-dom';
import { LegalFramework } from '../components/LegalFramework/LegalFramework.jsx';
import { LegalTopic } from '../components/LegalFramework/LegalTopic.jsx';

export default function LegalPage() {
  const { topic } = useParams();
  if (topic) return <LegalTopic topic={topic} />;
  return <LegalFramework />;
}
