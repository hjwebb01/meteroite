"use client";
import { Poppins } from "next/font/google";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SparklesIcon } from "lucide-react";
import { FaGithub } from "react-icons/fa";

import { Kbd } from "@/components/ui/kbd";
import { ProjectsList } from "./projects-list";
import { useState, useEffect } from "react";
import { ProjectsCommandDialog } from "./projects-command-dialog";
import { ImportGithubDialog } from "./import-github-dialog";
import { NewProjectDialog } from "./new-project-dialog";
import Link from "next/link";
import { SearchCode } from "lucide-react";
const font = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const ProjectsView = () => {
  const [commandDialogOpen, setCommandDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || (e.ctrlKey && e.key === "k")) {
        e.preventDefault();
        setCommandDialogOpen(true);
      }
      if (e.key === "i") {
        e.preventDefault();
        setImportDialogOpen(true);
      }
      if (e.key === "j") {
        e.preventDefault();
        setNewProjectDialogOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <ProjectsCommandDialog
        open={commandDialogOpen}
        onOpenChange={setCommandDialogOpen}
      />
      <ImportGithubDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
      />
      <NewProjectDialog
        open={newProjectDialogOpen}
        onOpenChange={setNewProjectDialogOpen}
      />
      <div className="min-h-screen bg-sidebar flex flex-col items-center justify-center p-6 md:p-16">
        <div className="w-full max-w-sm mx-auto flex flex-col gap-4 items-center">
          <div className="flex justify-between gap-4 w-full items-center">
            <div className="flex items-center gap-2 w-full group/logo">
              {/* eslint-disable-next-line @next/next/no-img-element -- static SVG gains nothing from next/image */}
              <img
                src="/logo.svg"
                alt="Meteroite"
                className="size-[60px] md:size[70px] rounded-lg"
              />
              <h1
                className={cn(
                  "text-4xl md:text-5xl font-semibold",
                  font.className,
                )}
              >
                Meteroite
              </h1>
            </div>
          </div>
          <div className="flex flex-col gap-4 w-full">
            <Button
              asChild
              variant="outline"
              className="h-auto justify-start gap-3 bg-background p-4"
            >
              <Link href="/reviews">
                <SearchCode className="size-5" />
                <span className="text-left">
                  <span className="block text-sm font-medium">
                    Review a pull request
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Private findings with repository context
                  </span>
                </span>
              </Link>
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setNewProjectDialogOpen(true);
                }}
                className="h-full items-start justify-start p-4 bg-background border flex flex-col gap-6 rounded-e-md"
              >
                <div className="flex items-center justify-between w-full">
                  <SparklesIcon className="size-4" />
                  <Kbd className="bg-accent border">ctrl+J</Kbd>
                </div>
                <div>
                  <span className="text-sm">New Project</span>
                </div>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setImportDialogOpen(true);
                }}
                className="h-full items-start justify-start p-4 bg-background border flex flex-col gap-6 rounded-e-md"
              >
                <div className="flex items-center justify-between w-full">
                  <FaGithub className="size-4" />
                  <Kbd className="bg-accent border">ctrl+I</Kbd>
                </div>
                <div>
                  <span className="text-sm">Import Project</span>
                </div>
              </Button>
            </div>
            <ProjectsList onViewAll={() => setCommandDialogOpen(true)} />
          </div>
        </div>
      </div>
    </>
  );
};
