'use client';

import React from 'react';
import { ExpertPickCandidate } from '@/types/expert-picks';
import { ExpertPickCard } from './ExpertPickCard';

interface Props {
  picks: ExpertPickCandidate[];
  onEnter: (pick: ExpertPickCandidate) => void;
  enteringPickId: string | null;
  availableCash: number;
  onSelect?: (pick: ExpertPickCandidate) => void;
}

export function ExpertPickGrid({ picks, onEnter, enteringPickId, availableCash, onSelect }: Props) {
  if (!picks || picks.length === 0) {
    return (
      <div className="bg-[#0f172a] border border-border rounded-xl p-8 text-center">
        <p className="text-slate-400">No expert picks available for current market conditions.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
      {picks.map((pick, i) => {
        const id = `${pick.underlying}_${pick.strike}_${pick.optionType}`;
        return (
          <ExpertPickCard 
            key={id + i} 
            pick={pick} 
            onEnter={onEnter}
            onSelect={onSelect}
            isEntering={enteringPickId === id}
            availableCash={availableCash}
          />
        );
      })}
    </div>
  );
}
