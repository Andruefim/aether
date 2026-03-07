import React from 'react';
import { NovaOrb } from './NovaOrb';
import { TokenGlyphSystem, type IncomingToken } from './TokenGlyphSystem';
import { ConstellationField } from './ConstellationField';

interface NovaSceneProps {
  tokenBucketRef: React.MutableRefObject<IncomingToken[]>;
  settleSignalRef: React.MutableRefObject<string>;
  highlightIdsRef: React.MutableRefObject<Set<string>>;
}

export function NovaScene({ tokenBucketRef, settleSignalRef, highlightIdsRef }: NovaSceneProps) {
  return (
    <>
      <ambientLight intensity={0.15} />
      <pointLight position={[-3,  3, 4]} intensity={1.2} color="#a070ff" />
      <pointLight position={[ 3, -1, 3]} intensity={0.6} color="#ff9040" />
      <pointLight position={[ 0,  0,-5]} intensity={0.4} color="#4080ff" />

      {/* Memory constellation — renders behind everything */}
      <ConstellationField highlightIdsRef={highlightIdsRef} />

      <NovaOrb />

      {/* bucketRef — живая ссылка, читается каждый RAF без ре-рендеров */}
      <TokenGlyphSystem bucketRef={tokenBucketRef} settleSignalRef={settleSignalRef} />
    </>
  );
}