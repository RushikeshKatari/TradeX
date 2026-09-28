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
      {Array.from(new Map(picks.map((pick) => [`${pick.underlying}_${pick.strike}`, pick])).values()).map((pick, i) => {
        const pairTypes = picks.filter((candidate) => candidate.underlying === pick.underlying && candidate.strike === pick.strike).map((candidate) => candidate.optionType);
        const pairedPick = { ...pick, pairedOptionTypes: pairTypes };
        const otherLeg = picks.find((candidate) => candidate.underlying === pick.underlying && candidate.strike === pick.strike && candidate.optionType !== pick.optionType);
        const id = `${pick.underlying}_${pick.strike}_${pick.optionType}`;
        return (
          <ExpertPickCard 
            key={id + i} 
            pick={pairedPick} 
            onEnter={onEnter}
            onSelect={onSelect}
            isEntering={enteringPickId === id}
            availableCash={availableCash}
            pairedPick={otherLeg}
          />
        );
      })}
    </div>
  );
}
