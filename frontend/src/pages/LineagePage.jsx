import React from 'react';
import { useParams } from 'react-router-dom';
import { LineageGraph } from '../components/LineageGraph/LineageGraph.jsx';

export default function LineagePage() {
  const { sessionId } = useParams();
  return <LineageGraph focusSessionId={sessionId} />;
}
