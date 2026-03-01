import React from 'react';
import { NovaOrb } from './NovaOrb';
import { TokenGlyphSystem, type IncomingToken } from './TokenGlyphSystem';

interface NovaSceneProps {
  tokenBucketRef: React.MutableRefObject<IncomingToken[]>;
}

export function NovaScene({ tokenBucketRef }: NovaSceneProps) {
  return (
    <>
      <ambientLight intensity={0.15} />
      <pointLight position={[-3,  3, 4]} intensity={1.2} color="#a070ff" />
      <pointLight position={[ 3, -1, 3]} intensity={0.6} color="#ff9040" />
      <pointLight position={[ 0,  0,-5]} intensity={0.4} color="#4080ff" />

      <NovaOrb />

      {/* bucketRef — живая ссылка, читается каждый RAF без ре-рендеров */}
      <TokenGlyphSystem bucketRef={tokenBucketRef} />
    </>
  );
}