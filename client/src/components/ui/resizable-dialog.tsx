import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X, GripHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"

const ResizableDialog = DialogPrimitive.Root
const ResizableDialogTrigger = DialogPrimitive.Trigger
const ResizableDialogPortal = DialogPrimitive.Portal
const ResizableDialogClose = DialogPrimitive.Close

const ResizableDialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
ResizableDialogOverlay.displayName = "ResizableDialogOverlay"

interface ResizableDialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
}

const ResizableDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ResizableDialogContentProps
>(({ 
  className, 
  children, 
  defaultWidth = 800, 
  defaultHeight = 600,
  minWidth = 400,
  minHeight = 300,
  maxWidth = window.innerWidth - 40,
  maxHeight = window.innerHeight - 40,
  ...props 
}, ref) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const [size, setSize] = React.useState({ width: defaultWidth, height: defaultHeight })
  const [isDragging, setIsDragging] = React.useState(false)
  const [isResizing, setIsResizing] = React.useState(false)
  const [dragStart, setDragStart] = React.useState({ x: 0, y: 0 })
  const [resizeStart, setResizeStart] = React.useState({ x: 0, y: 0, width: 0, height: 0 })
  const contentRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setPosition({
      x: (window.innerWidth - size.width) / 2,
      y: (window.innerHeight - size.height) / 2
    })
  }, [])

  const handleDragStart = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
    e.preventDefault()
    e.stopPropagation()
  }

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true)
    setResizeStart({ x: e.clientX, y: e.clientY, width: size.width, height: size.height })
    e.preventDefault()
    e.stopPropagation()
  }

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newX = Math.max(0, Math.min(window.innerWidth - size.width, e.clientX - dragStart.x))
        const newY = Math.max(0, Math.min(window.innerHeight - size.height, e.clientY - dragStart.y))
        setPosition({ x: newX, y: newY })
      }
      if (isResizing) {
        const deltaX = e.clientX - resizeStart.x
        const deltaY = e.clientY - resizeStart.y
        const newWidth = Math.max(minWidth, Math.min(maxWidth, resizeStart.width + deltaX))
        const newHeight = Math.max(minHeight, Math.min(maxHeight, resizeStart.height + deltaY))
        setSize({ width: newWidth, height: newHeight })
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(false)
    }

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, isResizing, dragStart, resizeStart, size, minWidth, minHeight, maxWidth, maxHeight])

  return (
    <ResizableDialogPortal>
      <ResizableDialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        style={{
          left: position.x,
          top: position.y,
          width: size.width,
          height: size.height,
        }}
        className={cn(
          "fixed z-50 flex flex-col border bg-background shadow-lg sm:rounded-lg overflow-hidden",
          isDragging && "cursor-grabbing select-none",
          className
        )}
        {...props}
      >
        <div 
          data-drag-handle
          onMouseDown={handleDragStart}
          className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b cursor-grab active:cursor-grabbing select-none shrink-0"
        >
          <div className="flex items-center gap-2 text-muted-foreground">
            <GripHorizontal className="h-4 w-4" />
            <span className="text-xs">Drag to move</span>
          </div>
          <DialogPrimitive.Close className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
        <div className="flex-1 overflow-auto p-6">
          {children}
        </div>
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
          style={{
            background: 'linear-gradient(135deg, transparent 50%, hsl(var(--muted-foreground) / 0.3) 50%)'
          }}
        />
      </DialogPrimitive.Content>
    </ResizableDialogPortal>
  )
})
ResizableDialogContent.displayName = "ResizableDialogContent"

const ResizableDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props}
  />
)
ResizableDialogHeader.displayName = "ResizableDialogHeader"

const ResizableDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
)
ResizableDialogFooter.displayName = "ResizableDialogFooter"

const ResizableDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
ResizableDialogTitle.displayName = "ResizableDialogTitle"

const ResizableDialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
ResizableDialogDescription.displayName = "ResizableDialogDescription"

export {
  ResizableDialog,
  ResizableDialogPortal,
  ResizableDialogOverlay,
  ResizableDialogTrigger,
  ResizableDialogClose,
  ResizableDialogContent,
  ResizableDialogHeader,
  ResizableDialogFooter,
  ResizableDialogTitle,
  ResizableDialogDescription,
}
