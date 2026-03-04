import { cn } from "@/lib/utils";
import { FileIcon, FolderIcon } from "@react-symbols/icons/utils";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { getItemPadding } from "./constants";
export const RenameInput = ({
  type,
  defaultValue,
  level,
  isOpen,
  onSubmit,
  onCancel,
}: {
  type: "file" | "folder",
  defaultValue: string,
  level: number,
  isOpen?: boolean,
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) => {
  const [value, setValue] = useState(defaultValue);

  const handleSubmit = () => {
    const trimmedValue = value.trim() || defaultValue;
    onSubmit(trimmedValue);
  }

  return (
    <div className="w-full flex items-center gap-1 h-5.5 bg-accent/30"
      style={ { paddingLeft: getItemPadding(level, type === "file") } }
    >
      <div className="flex items-center gap-0.5">
        { type === "folder" && (
          <ChevronRightIcon className={ cn("size-4 shrink-0 text-muted-foreground",
            isOpen && "rotate-90") } />
        ) }
        { type === "file" && (
          <FileIcon fileName={ value } autoAssign className="size-4" />
        ) }
        { type === "folder" && (
          <FolderIcon folderName={ value } className="size-4" />
        ) }
      </div>
      <input
        autoFocus
        type="text"
        value={ value }
        onChange={ (e) => setValue(e.target.value) }
        className="bg-transparent outline-none flex-1 text-sm focus:ring-1 focus:ring-inset focus:ring-ring"
        onBlur={ handleSubmit }
        onKeyDown={ (e) => {
          if (e.key === "Enter") {
            handleSubmit();
          }
          if (e.key === "Escape") {
            onCancel();
          }
        } }
        onFocus={ (e) => {
          if (type === "folder") {
            e.currentTarget.select();
          } else {
            const value = e.currentTarget.value;
            const lastDotIndex = value.lastIndexOf(".");
            if (lastDotIndex > 0) {
              e.currentTarget.setSelectionRange(0, lastDotIndex);
            } else {
              e.currentTarget.select();
            }
          }
        } }
      />
    </div>
  )
};