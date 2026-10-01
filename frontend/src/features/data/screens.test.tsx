import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { ApiRequestError } from './api'
import { DataSourcesScreen } from './data-sources-screen'
import { UploadScreen } from './upload-screen'
import { REAL, detail, fakeDataApi, renderData } from '@/test/data'

let click: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
})

afterEach(() => {
  click.mockRestore()
})

function csv(content = 'Store Code,Department,Date,Hour,Transactions,Lanes Open\n0001,Main,2025-08-01,9,120,4\n', name = 'pos_hourly_2025.csv') {
  return new File([content], name, { type: 'text/csv' })
}

describe('SCR-050 Data sources and ingestion', () => {
  it('shows a loading skeleton, then datasets and history', async () => {
    renderData(<DataSourcesScreen api={fakeDataApi()} />)
    expect(screen.getByText('Loading datasets')).toBeInTheDocument()
    const datasets = await screen.findByRole('table', { name: 'Datasets' })
    expect(within(datasets).getByRole('rowheader', { name: 'POS hourly transactions' })).toBeInTheDocument()
    expect(within(datasets).getByText('47,548')).toBeInTheDocument()
    expect(within(datasets).getByText('Not loaded')).toBeInTheDocument()
    const history = await screen.findByRole('table', { name: 'Ingestion history' })
    expect(within(history).getByText('3 scenarios marked stale')).toBeInTheDocument()
    expect(within(history).getByText('Rejected')).toBeInTheDocument()
  })

  it('shows the non-dismissible sample-data banner only while sample data is in use', async () => {
    const { unmount } = renderData(<DataSourcesScreen api={fakeDataApi()} />)
    const banner = await screen.findByTestId('sample-data-banner')
    expect(banner).toHaveTextContent('Sample data')
    expect(within(banner).queryByRole('button')).toBeNull()
    unmount()

    const api = fakeDataApi({ listDatasets: vi.fn().mockResolvedValue({ datasets: [], provenance: REAL }) })
    renderData(<DataSourcesScreen api={api} />)
    await screen.findByRole('table', { name: 'Datasets' })
    expect(screen.queryByTestId('sample-data-banner')).toBeNull()
    expect(screen.getByText(/No datasets are set up yet/)).toBeInTheDocument()
  })

  it('shows the empty history state', async () => {
    const api = fakeDataApi({ listIngestions: vi.fn().mockResolvedValue({ runs: [], provenance: REAL }) })
    renderData(<DataSourcesScreen api={api} />)
    expect(await screen.findByText('No files have been uploaded yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export history' })).toBeDisabled()
  })

  it('shows an error state with a reference ID and retries', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi({
      listDatasets: vi
        .fn()
        .mockRejectedValueOnce(new ApiRequestError('service_unavailable', 503, 'x', 'req-9'))
        .mockResolvedValue({ datasets: [], provenance: REAL }),
    })
    renderData(<DataSourcesScreen api={api} />)
    expect(await screen.findByText('We couldn’t load the data sources')).toBeInTheDocument()
    expect(screen.getByText('req-9')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('table', { name: 'Datasets' })).toBeInTheDocument()
  })

  it('shows no-access on 403 without partial data', async () => {
    const api = fakeDataApi({ listDatasets: vi.fn().mockRejectedValue(new ApiRequestError('forbidden', 403, 'x', 'r')) })
    renderData(<DataSourcesScreen api={api} />)
    expect(await screen.findByText('You don’t have access to this')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('opens the upload flow via the callback', async () => {
    const user = userEvent.setup()
    const onUpload = vi.fn()
    renderData(<DataSourcesScreen api={fakeDataApi()} onUpload={onUpload} />)
    await user.click(await screen.findByRole('button', { name: 'Upload file' }))
    expect(onUpload).toHaveBeenCalled()
  })

  it('hides Upload and Change for roles other than Rules Steward', async () => {
    renderData(<DataSourcesScreen api={fakeDataApi()} role="PLN" />)
    await screen.findByRole('table', { name: 'Datasets' })
    expect(screen.queryByRole('button', { name: 'Upload file' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Change the synthetic flag/ })).toBeNull()
  })

  it('clears the synthetic flag after confirmation and reloads', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi()
    renderData(<DataSourcesScreen api={api} role="RST" />)
    await user.click(await screen.findByRole('button', { name: 'Change the synthetic flag for POS hourly transactions' }))
    const dialog = await screen.findByRole('dialog', { name: 'Mark POS hourly transactions as real data?' })
    await user.click(within(dialog).getByRole('button', { name: 'Mark as real data' }))
    expect(api.updateSnapshot).toHaveBeenCalledWith('snap-pos-1', { synthetic: false })
    // Shown on the page (a note) and announced via the live region.
    const notices = await screen.findAllByText('POS hourly transactions is now marked as real data.')
    expect(notices.some((el) => el.closest('[role="note"]'))).toBe(true)
    await waitFor(() => expect(api.listDatasets).toHaveBeenCalledTimes(2))
  })

  it('shows the 403 when the flag change is refused', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi({ updateSnapshot: vi.fn().mockRejectedValue(new ApiRequestError('forbidden', 403, 'x', 'req-403')) })
    renderData(<DataSourcesScreen api={api} />)
    await user.click(await screen.findByRole('button', { name: 'Change the synthetic flag for POS hourly transactions' }))
    await user.click(await screen.findByRole('button', { name: 'Mark as real data' }))
    expect(await screen.findByText('Only a Rules Steward can change whether a dataset is sample data.')).toBeInTheDocument()
    expect(screen.getByText('req-403')).toBeInTheDocument()
  })

  it('exports history and downloads a rejected run’s error report', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi()
    renderData(<DataSourcesScreen api={api} />)
    await user.click(await screen.findByRole('button', { name: 'Export history' }))
    expect(api.exportHistory).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Download the error report for pos_hourly_2025.csv' }))
    expect(api.getReport).toHaveBeenCalledWith('run-0')
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2))
  })

  it('has no axe violations', async () => {
    const { container } = renderData(<DataSourcesScreen api={fakeDataApi()} />)
    await screen.findByRole('table', { name: 'Ingestion history' })
    expect(await axe(container)).toHaveNoViolations()
  })
})

async function toMapping(user: ReturnType<typeof userEvent.setup>, file = csv()) {
  await user.upload(screen.getByLabelText(/CSV file/), file)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'Map columns' })
}

async function toValidation(user: ReturnType<typeof userEvent.setup>) {
  await toMapping(user)
  await user.click(screen.getByRole('button', { name: 'Upload and validate' }))
  await screen.findByRole('heading', { name: /Validation results/ })
}

describe('SCR-051 Upload and validation', () => {
  it('marks the current step with aria-current', async () => {
    const user = userEvent.setup()
    renderData(<UploadScreen api={fakeDataApi()} onDone={vi.fn()} />)
    const steps = screen.getByRole('list', { name: 'Upload steps' })
    expect(within(steps).getByText('Choose file').closest('li')).toHaveAttribute('aria-current', 'step')
    await toMapping(user)
    expect(within(steps).getByText('Map columns').closest('li')).toHaveAttribute('aria-current', 'step')
    expect(within(steps).getByText('Choose file').closest('li')).not.toHaveAttribute('aria-current')
  })

  it('requires a CSV file', async () => {
    const user = userEvent.setup()
    renderData(<UploadScreen api={fakeDataApi()} onDone={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Choose a CSV file to upload.')).toBeInTheDocument()
    expect(screen.getByLabelText(/CSV file/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('auto-maps headers and blocks upload until required fields are mapped', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi()
    renderData(<UploadScreen api={api} onDone={vi.fn()} />)
    await toMapping(user)
    expect(screen.getByLabelText(/^Store code/)).toHaveValue('Store Code')
    expect(screen.getByLabelText(/^Lanes open/)).toHaveValue('Lanes Open')
    expect(screen.getByLabelText(/^Average handle time/)).toHaveValue('')

    await user.selectOptions(screen.getByLabelText(/^Transactions/), '')
    await user.click(screen.getByRole('button', { name: 'Upload and validate' }))
    expect(await screen.findByText('Choose the column for this required field.')).toBeInTheDocument()
    expect(api.requestUploadUrl).not.toHaveBeenCalled()
  })

  it('uploads via presign → PUT → validate with the mapping and synthetic flag', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi()
    renderData(<UploadScreen api={api} onDone={vi.fn()} />)
    await user.click(screen.getByLabelText('This dataset is synthetic / sample data'))
    const file = csv()
    await toMapping(user, file)
    await user.click(screen.getByRole('button', { name: 'Upload and validate' }))
    await screen.findByRole('heading', { name: /Validation results/ })
    expect(api.requestUploadUrl).toHaveBeenCalledWith({
      datasetType: 'pos',
      fileName: 'pos_hourly_2025.csv',
      contentType: 'text/csv',
      sizeBytes: file.size,
    })
    expect(api.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ fileKey: 'uploads/pos/abc.csv' }), file)
    expect(api.createIngestion).toHaveBeenCalledWith({
      datasetType: 'pos',
      fileKey: 'uploads/pos/abc.csv',
      fileName: 'pos_hourly_2025.csv',
      synthetic: true,
      columnMapping: {
        store_code: 'Store Code',
        department: 'Department',
        date: 'Date',
        hour: 'Hour',
        transactions: 'Transactions',
        lanes_open: 'Lanes Open',
      },
    })
    expect(screen.getByText('47,540 rows valid')).toBeInTheDocument()
    expect(screen.getByText('8 warnings')).toBeInTheDocument()
    expect(screen.getByText('0 errors')).toBeInTheDocument()
    expect(screen.getByText('2 scenarios will be marked stale; their owners will be notified.')).toBeInTheDocument()
    expect(screen.getByText('Christmas 2026 v3')).toBeInTheDocument()
    const issues = screen.getByRole('table', { name: 'Validation issues' })
    expect(within(issues).getByText('1,204')).toBeInTheDocument()
  })

  it('downloads the full validation report', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi()
    renderData(<UploadScreen api={api} onDone={vi.fn()} />)
    await toValidation(user)
    await user.click(screen.getByRole('button', { name: 'Download full report' }))
    expect(api.getReport).toHaveBeenCalledWith('run-new')
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
  })

  it('blocks loading when the file has errors, explaining the prior data stays active', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi({
      createIngestion: vi.fn().mockResolvedValue(detail({ status: 'blocked', errorCount: 112, validRowCount: 47436 })),
    })
    renderData(<UploadScreen api={api} onDone={vi.fn()} />)
    await toValidation(user)
    expect(screen.getByText('This file can’t be loaded')).toBeInTheDocument()
    expect(screen.getByText(/The current POS hourly transactions data stays active/)).toBeInTheDocument()
    const load = screen.getByRole('button', { name: 'Load data' })
    expect(load).toBeDisabled()
    expect(load).toHaveAccessibleDescription(/Fix the 112 errors/)
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(api.loadIngestion).not.toHaveBeenCalled()
  })

  it('requires explicit confirmation of warnings before loading', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi()
    const onDone = vi.fn()
    renderData(<UploadScreen api={api} onDone={onDone} />)
    await toValidation(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Confirm and load' })
    const load = screen.getByRole('button', { name: 'Load data' })
    expect(load).toBeDisabled()
    await user.click(screen.getByLabelText('I’ve reviewed the 8 warnings and want to load this file anyway.'))
    expect(load).toBeEnabled()
    await user.click(load)
    expect(api.loadIngestion).toHaveBeenCalledWith('run-new', { confirmWarnings: true })
    expect(await screen.findByRole('heading', { name: 'Data loaded' })).toBeInTheDocument()
    expect(screen.getByText('1 scenario was marked stale; its owner has been notified.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to data sources' }))
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ staleScenarios: expect.any(Array) }))
  })

  it('loads without a checkbox when there are no warnings', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi({
      createIngestion: vi.fn().mockResolvedValue(detail({ warningCount: 0, validRowCount: 47548 }, { issues: [], impact: [] })),
    })
    renderData(<UploadScreen api={api} onDone={vi.fn()} />)
    await toValidation(user)
    expect(screen.getByText(/so none will be marked stale/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.queryByRole('checkbox')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Load data' }))
    expect(api.loadIngestion).toHaveBeenCalledWith('run-new', { confirmWarnings: false })
  })

  it('explains a 409 when the dataset changed since validation', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi({
      createIngestion: vi.fn().mockResolvedValue(detail({ warningCount: 0 }, { issues: [] })),
      loadIngestion: vi.fn().mockRejectedValue(new ApiRequestError('conflict', 409, 'x', 'req-409')),
    })
    renderData(<UploadScreen api={api} onDone={vi.fn()} />)
    await toValidation(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Load data' }))
    expect(await screen.findByText(/changed after this file was validated/)).toBeInTheDocument()
    expect(screen.getByText('req-409')).toBeInTheDocument()
  })

  it('shows an upload failure with retry', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi({
      uploadFile: vi.fn().mockRejectedValueOnce(new ApiRequestError('forbidden', 403, 'x')).mockResolvedValue(undefined),
    })
    renderData(<UploadScreen api={api} onDone={vi.fn()} />)
    await toMapping(user)
    await user.click(screen.getByRole('button', { name: 'Upload and validate' }))
    expect(await screen.findByText(/Only a Rules Steward can manage data ingestion/)).toBeInTheDocument()
    expect(api.createIngestion).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: /Validation results/ })).toBeInTheDocument()
  })

  it('Cancel cancels the run and leaves the flow', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi()
    const onDone = vi.fn()
    renderData(<UploadScreen api={api} onDone={onDone} />)
    await toValidation(user)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith())
    expect(api.cancelIngestion).toHaveBeenCalledWith('run-new')
  })

  it('Cancel before an upload does not call the API', async () => {
    const user = userEvent.setup()
    const api = fakeDataApi()
    const onDone = vi.fn()
    renderData(<UploadScreen api={api} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api.cancelIngestion).not.toHaveBeenCalled()
  })

  it('shows no-access for non-stewards', () => {
    renderData(<UploadScreen api={fakeDataApi()} onDone={vi.fn()} role="STM" />)
    expect(screen.getByText('You don’t have access to this')).toBeInTheDocument()
    expect(screen.queryByLabelText(/CSV file/)).toBeNull()
  })

  it('shows the sample-data banner from provenance', async () => {
    renderData(<UploadScreen api={fakeDataApi()} onDone={vi.fn()} />)
    expect(await screen.findByTestId('sample-data-banner')).toBeInTheDocument()
  })

  it('has no axe violations on each step', async () => {
    const user = userEvent.setup()
    const { container } = renderData(<UploadScreen api={fakeDataApi()} onDone={vi.fn()} />)
    await screen.findByTestId('sample-data-banner')
    expect(await axe(container)).toHaveNoViolations()
    await toMapping(user)
    expect(await axe(container)).toHaveNoViolations()
    await user.click(screen.getByRole('button', { name: 'Upload and validate' }))
    await screen.findByRole('heading', { name: /Validation results/ })
    expect(await axe(container)).toHaveNoViolations()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Confirm and load' })
    expect(await axe(container)).toHaveNoViolations()
  })

  it('renders in Filipino', async () => {
    renderData(<UploadScreen api={fakeDataApi()} onDone={vi.fn()} />, 'fil')
    expect(await screen.findByTestId('sample-data-banner')).toHaveTextContent('Halimbawang datos')
    expect(screen.getByRole('heading', { level: 1, name: 'Mag-upload ng datos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Magpatuloy' })).toBeInTheDocument()
  })
})
