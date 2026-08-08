// Stat tile in the Starlink app layout: bold title, big number with the
// sparkline running inline to its right, gray caption underneath.

import { Sparkline } from "../../assets/icons/Sparkline";

export interface StatTileProps {
  label: string;
  value: string;
  unit?: string;
  caption?: string;
  sparkValues?: (number | null)[];
  sparkColorVar?: string;
  /** Opens the stat's detail panel; renders the tile as a button with a chevron. */
  onOpenDetail?: () => void;
}

// Card shell + tile layout. The clickable variant is a real <button>, so it has to
// undo what the browser gives buttons — appearance, font and text alignment — to
// sit flush with the static tiles beside it.
const tileBase = "flex min-w-0 flex-col gap-1 rounded-xl bg-card px-[17px] py-[15px]";
const tileClickable =
  "cursor-pointer border-0 text-left text-inherit [appearance:none] [font:inherit] [transition:background_120ms_ease,transform_120ms_ease] hover:bg-secondary active:scale-[0.99]";

export function StatTile({
  label,
  value,
  unit,
  caption,
  sparkValues,
  sparkColorVar,
  onOpenDetail,
}: StatTileProps) {
  const TileElement = onOpenDetail ? "button" : "div";
  return (
    <TileElement
      className={onOpenDetail ? `${tileBase} ${tileClickable}` : tileBase}
      onClick={onOpenDetail}
      type={onOpenDetail ? "button" : undefined}
    >
      <span className='flex items-center justify-between text-[14px] font-semibold text-foreground'>
        {label}
        {onOpenDetail && <span className='text-[16px] leading-none text-muted-foreground'>›</span>}
      </span>
      <div className='flex min-h-10 items-center gap-1.5'>
        <span className='text-[34px] font-bold leading-none tracking-[-0.01em]'>{value}</span>
        {unit && (
          <span className='self-end pb-[5px] text-[13px] font-medium text-muted-foreground'>
            {unit}
          </span>
        )}
        {sparkValues && (
          <Sparkline
            values={sparkValues}
            colorVar={sparkColorVar}
            className='ml-1 block min-w-0 flex-1'
          />
        )}
      </div>
      {caption && (
        <span className='text-[11.5px] font-medium text-muted-foreground'>{caption}</span>
      )}
    </TileElement>
  );
}
