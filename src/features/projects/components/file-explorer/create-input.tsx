import { useState } from "react";

export const CreateInput = ({
  type,
  level,
  onSubmit,
  onCancel,
}: {
  type: "file" | "folder",
  level: number,
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) => {
  const [value, setValue] = useState("");

  const handleSubmit = () => {
    const trimmedValue = value.trim();
    if (trimmedValue) {
      onSubmit(trimmedValue);
    } else {
      onCancel();
    }
  };

  return (
    <div className="w-full flex items-center gap-1 h-5.5 bg-accent/30">
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
        
      />
    </div>
  )
};