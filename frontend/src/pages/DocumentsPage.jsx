import React from 'react';
import { useParams } from 'react-router-dom';
import { DocumentViewer } from '../components/DocumentViewer/DocumentViewer.jsx';
import { DocumentList } from '../components/DocumentViewer/DocumentList.jsx';

export default function DocumentsPage() {
  const { id } = useParams();
  if (id) return <DocumentViewer documentId={id} />;
  return <DocumentList />;
}
