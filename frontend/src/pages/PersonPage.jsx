import React from 'react';
import { useParams } from 'react-router-dom';
import { PersonProfile } from '../components/PersonModal/PersonProfile.jsx';

export default function PersonPage() {
  const { source, id } = useParams();
  return <PersonProfile personId={id} tableSource={source} />;
}
