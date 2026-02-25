'use client';

import QuestionMarkCircledIcon from '@/components/icons/QuestionMarkCircledIcon';
import {
  Tooltip,
  TooltipTrigger,
  TooltipPortal,
  TooltipPositioner,
  TooltipPopup,
  TooltipArrow,
} from '@/components/ui/tooltip/tooltip';

export default function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors cursor-help"
      >
        <QuestionMarkCircledIcon size={14} />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipPositioner sideOffset={6}>
          <TooltipPopup>
            <TooltipArrow />
            {text}
          </TooltipPopup>
        </TooltipPositioner>
      </TooltipPortal>
    </Tooltip>
  );
}
