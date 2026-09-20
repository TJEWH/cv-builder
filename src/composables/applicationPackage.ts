import type { ApplicationPackageItem, ApplicationPackageManifest, LocalDocument, PackageCompositionResult } from '../documentTypes';

export interface ApplicationPackageSources {
  cvReady: boolean;
  letterReady: boolean;
  getCvPdf: () => Promise<Blob>;
  getLetterPdf: () => Promise<Blob>;
  getDocument: (documentId: string) => Promise<LocalDocument | undefined>;
}

export function packageItemProblem(item: ApplicationPackageItem, availableDocumentIds: Set<string>, cvReady: boolean, letterReady: boolean): string | null {
  if (!item.included) return null;
  if (item.kind === 'cv' && !cvReady) return 'Assign a CV to this application first.';
  if (item.kind === 'letter' && !letterReady) return 'Finalize the motivation letter and resolve its placeholders first.';
  if (item.kind === 'attachment' && (!item.documentId || !availableDocumentIds.has(item.documentId))) return `${item.label}: unavailable on this device. Restore its document backup or remove it from the package.`;
  return null;
}

/** Copy original PDF page content, retaining text/vectors. Images become centered A4 pages. */
export async function composeApplicationPackage(manifest: ApplicationPackageManifest, sources: ApplicationPackageSources): Promise<PackageCompositionResult> {
  const included = manifest.items.filter((item) => item.included);
  if (!included.length) throw new Error('Include at least one document in the application package.');
  // Resolve every required input first: missing files must never yield a partial package.
  const resolved: { item: ApplicationPackageItem; blob: Blob; mimeType: string }[] = [];
  for (const item of included) {
    if (item.kind === 'cv') {
      if (!sources.cvReady) throw new Error('Assign a CV to this application first.');
      resolved.push({ item, blob: await sources.getCvPdf(), mimeType: 'application/pdf' });
    } else if (item.kind === 'letter') {
      if (!sources.letterReady) throw new Error('Finalize the motivation letter and resolve its placeholders first.');
      resolved.push({ item, blob: await sources.getLetterPdf(), mimeType: 'application/pdf' });
    } else {
      const document = item.documentId ? await sources.getDocument(item.documentId) : undefined;
      if (!document?.blob) throw new Error(`${item.label}: unavailable on this device. Restore its document backup or remove it from the package.`);
      resolved.push({ item, blob: document.blob, mimeType: document.mimeType });
    }
  }
  const { PDFDocument, PDFDict, PDFName, PageSizes } = await import('pdf-lib');
  const output = await PDFDocument.create();
  output.setTitle('Application documents');
  output.setCreator('CV Builder');
  const documents: PackageCompositionResult['documents'] = [];
  for (const { item, blob, mimeType } of resolved) {
    const firstPage = output.getPageCount() + 1;
    try {
      const bytes = await blob.arrayBuffer();
      if (mimeType === 'application/pdf') {
        const source = await PDFDocument.load(bytes);
        if (!source.getPageCount()) throw new Error('The PDF has no pages.');
        // Flatten supported form fields so their filled appearance survives page copying.
        // getForm() removes XFA automatically, so detect it before asking for the form.
        if (source.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.has(PDFName.of('XFA'))) throw new Error('This PDF uses an unsupported XFA form. Print it to a normal PDF before adding it.');
        const form = source.getForm();
        if (form.getFields().length) form.flatten();
        const pages = await output.copyPages(source, source.getPageIndices());
        for (const page of pages) output.addPage(page);
      } else if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
        const image = mimeType === 'image/png' ? await output.embedPng(bytes) : await output.embedJpg(bytes);
        const page = output.addPage(PageSizes.A4);
        const scale = Math.min((page.getWidth() - 48) / image.width, (page.getHeight() - 48) / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        page.drawImage(image, { x: (page.getWidth() - width) / 2, y: (page.getHeight() - height) / 2, width, height });
      } else throw new Error('Unsupported document format.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The document could not be read.';
      throw new Error(`Could not include “${item.label}”. ${detail} Password-protected or damaged PDFs must be replaced with a readable copy.`);
    }
    documents.push({ itemId: item.id, label: item.label, firstPage, pageCount: output.getPageCount() - firstPage + 1 });
  }
  const bytes = await output.save();
  return { blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), pageCount: output.getPageCount(), documents };
}
