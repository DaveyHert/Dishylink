// Every rule on the network in one place, whether it was written here or from a
// device's own card.

import { useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { useDeviceGroups } from "../../../hooks/useDeviceGroups";
import { refreshMeterIndicators, removeDeviceRule, restartRule } from "../../../hooks/useDataMeter";
import { useRules, type Rule } from "../../../hooks/useRules";
import { Button } from "../../ui/button";
import { Callout } from "../../ui/callout";
import { EmptyState } from "../../ui/empty-state";
import { SpinLoader } from "../../loaders/SpinLoader";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { Dialog, DialogContent } from "../../ui/dialog";
import { RuleCard } from "./RuleCard";
import { RuleStatus } from "./RuleStatus";
import { RuleDialog } from "./RuleDialog";
import { MeterIcon } from "../../../assets/icons/MeterIcon";
import type { MemberCandidate } from "./allowanceTerms";

export function RulesTab({ candidates }: { candidates: MemberCandidate[] }) {
  const { rules, loading, error, reload } = useRules();
  const groups = useDeviceGroups();
  const [editing, setEditing] = useState<Rule | null>(null);
  const [viewing, setViewing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);
  // The list reloads every ten seconds, and a card held open should follow its
  // rule rather than the copy that was open when it was clicked.
  const shown = viewing && (rules.find((rule) => rule.id === viewing.id) ?? viewing);

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const removeRule = async (rule: Rule) => {
    // A rule written from a device's own card has no group behind it, and is
    // deleted through the device it names.
    if (rule.group) await groups.remove(rule.group.groupId);
    else await removeDeviceRule(rule.memberKeys[0]);
    await reload();
  };

  /** Start this rule's measures over. The rule, not its devices: a device can be
   *  named by several rules, and restarting each would restart the others too. */
  const restart = async (rule: Rule) => {
    await restartRule(
      rule.group ? { groupId: rule.group.groupId } : { clientKey: rule.memberKeys[0] },
    );
    await Promise.all([reload(), refreshMeterIndicators()]);
  };

  return (
    <div className='space-y-3.5'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <h2 className='flex items-center gap-1.5 text-[15px] font-semibold text-foreground'>
            <MeterIcon
              gearColor={rules.length < 1 ? "var(--ink)" : "var(--accent)"}
              className='size-[15px] flex-none text-muted-foreground'
            />
            Rules
          </h2>
          <p className='text-[12px] text-muted-foreground'>
            Manage data limits, schedules and timers, across the devices on your network.
          </p>
        </div>
        <Button
          size='sm'
          className='cursor-pointer bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] text-foreground hover:bg-[color-mix(in_srgb,var(--ink)_12%,transparent)]'
          onClick={() => setCreating(true)}
        >
          <Plus className='size-3.5' />
          New rule
        </Button>
      </div>

      {error && <Callout tone='error'>{error}</Callout>}

      {loading && rules.length === 0 ? (
        <div className='grid min-h-[160px] place-items-center'>
          <SpinLoader size={32} />
        </div>
      ) : (
        <div className='grid gap-3 sm:grid-cols-2'>
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onOpen={() => setViewing(rule)}
              action={
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type='button'
                      aria-label={`Actions for ${rule.name}`}
                      className='grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)] hover:text-foreground'
                    >
                      <MoreHorizontal className='size-4' />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align='end'
                    sideOffset={6}
                    className='w-44 rounded-xl border border-hairline dark:bg-card p-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]'
                  >
                    <button
                      type='button'
                      onClick={() => setEditing(rule)}
                      className='w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]'
                    >
                      Edit rule
                    </button>
                    <button
                      type='button'
                      onClick={() => void restart(rule)}
                      className='w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]'
                    >
                      {rule.countdownMs === undefined ? "Start cycle over" : "Restart timer"}
                    </button>
                    <button
                      type='button'
                      onClick={() => void removeRule(rule)}
                      className='w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left text-[13px] text-destructive transition-colors hover:bg-[color-mix(in_srgb,var(--status-critical)_10%,transparent)]'
                    >
                      Remove rule
                    </button>
                  </PopoverContent>
                </Popover>
              }
            />
          ))}

          <button
            type='button'
            onClick={() => setCreating(true)}
            className='grid min-h-[150px] cursor-pointer place-items-center rounded-xl border border-dashed border-border/70 text-muted-foreground transition-colors hover:border-border hover:text-foreground'
          >
            <span className='space-y-1.5 text-center'>
              <span className='mx-auto grid size-9 place-items-center rounded-full border border-border/70'>
                <Plus className='size-4' />
              </span>
              <span className='block text-[13px] font-medium'>Create a rule</span>
              <span className='block text-[11.5px] text-muted-foreground'>
                Group devices and set their limits
              </span>
            </span>
          </button>
        </div>
      )}

      {!loading && rules.length === 0 && (
        <EmptyState className='pt-1'>
          No rules yet. A rule can cap data, run a timer, or schedule when its devices are online.
        </EmptyState>
      )}

      <Dialog open={shown !== null && editing === null} onOpenChange={() => setViewing(null)}>
        <DialogContent
          className='thin-scroll max-h-[85vh] gap-0 overflow-y-auto rounded-xl border border-border/50 bg-surface-raised text-ink shadow-[0_12px_40px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)] sm:max-w-lg dark:bg-[color-mix(in_srgb,#0e0e0e_80%,transparent)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]'
          showCloseButton={false}
        >
          {shown && (
            <RuleStatus
              rule={shown}
              candidates={candidates}
              onEdit={() => setEditing(shown)}
              onClose={() => setViewing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <RuleDialog
        rule={editing ?? undefined}
        candidates={candidates}
        open={creating || editing !== null}
        onOpenChange={(next) => !next && close()}
        onSaved={() => {
          close();
          setViewing(null);
          void reload();
        }}
      />
    </div>
  );
}
