export interface UpdateParticipant { prepareUpdate(): Promise<boolean>; releaseUpdate(): void; }
export class UpdateParticipants {
  private participants = new Map<UpdateParticipant, number>();
  private preparing = false;
  private prepared = new Set<UpdateParticipant>();
  add(participant: UpdateParticipant): () => void {
    if (this.preparing) throw new Error('Обновление уже готовится.');
    this.participants.set(participant, (this.participants.get(participant) ?? 0) + 1);
    let active = true;
    return () => {
      if (!active) return; active = false;
      const count = this.participants.get(participant) ?? 0;
      if (count <= 1) this.participants.delete(participant); else this.participants.set(participant, count - 1);
    };
  }
  async prepareUpdate(): Promise<boolean> {
    this.preparing = true;
    this.prepared = new Set(this.participants.keys());
    const results = await Promise.allSettled([...this.prepared].map((p) => p.prepareUpdate()));
    return results.every((r) => r.status === 'fulfilled' && r.value);
  }
  releaseUpdate(): void {
    this.preparing = false;
    for (const participant of new Set([...this.participants.keys(), ...this.prepared])) participant.releaseUpdate();
    this.prepared.clear();
  }
}
export const updateParticipants = new UpdateParticipants();
