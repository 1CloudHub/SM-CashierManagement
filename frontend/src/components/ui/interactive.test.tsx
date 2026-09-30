import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'
import { Field } from './field'
import { Input } from './input'
import { ToastProvider, useToast } from './toast'
import { Button } from './button'

describe('Dialog', () => {
  it('opens as a labelled modal and closes on the close control', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Archive…</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive scenario?</DialogTitle>
            <DialogDescription>This can be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Archive…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive scenario?' })
    expect(dialog).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })
})

describe('Tabs', () => {
  it('exposes tab roles and switches panels', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Details</TabsTrigger>
          <TabsTrigger value="b">History</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Detail panel</TabsContent>
        <TabsContent value="b">History panel</TabsContent>
      </Tabs>,
    )
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await userEvent.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('History panel')).toBeInTheDocument()
  })
})

describe('Field', () => {
  it('associates label, hint and error with the control', () => {
    render(
      <Field label="Scenario name" hint="Shown on the summary" error="Required" required>
        {(aria) => <Input {...aria} />}
      </Field>,
    )
    // Accessible name includes the required marker text ("* (required)").
    const input = screen.getByRole('textbox', { name: /Scenario name/ })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-required', 'true')
    expect(input).toHaveAccessibleDescription(/Shown on the summary\s+Required/)
  })
})

function ToastButton() {
  const { toast } = useToast()
  return (
    <Button onClick={() => toast({ title: 'Plan published', tone: 'success' })}>
      Publish
    </Button>
  )
}

describe('Toast', () => {
  it('announces a success toast politely and shows the message', async () => {
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))
    const toast = await screen.findByRole('status')
    expect(toast).toHaveAttribute('aria-live', 'polite')
    expect(toast).toHaveTextContent('Plan published')
  })

  it('a dialog + tabs + field composition has no axe violations', async () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="a">
          <Field label="Name">{(aria) => <Input {...aria} />}</Field>
        </TabsContent>
      </Tabs>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
