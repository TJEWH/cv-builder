import html2pdf from 'html2pdf.js';

/**
 * Composable for exporting HTML elements to PDF
 */
export function usePdfExport() {
  /**
   * Export an HTML element to PDF
   * @param {HTMLElement} element - The DOM element to export
   * @param {string} filename - The filename for the PDF (without .pdf extension)
   * @param {Object} options - Additional options for html2pdf
   */
  const exportToPdf = async (element, filename = 'cv', options = {}) => {
    if (!element) {
      console.error('No element provided for PDF export');
      return;
    }

    const defaultOptions = {
      margin: 0,
      filename: `${filename}.pdf`,
      image: { type: 'jpeg', quality: 1 },
      html2canvas: {
        scale: 3, // Higher scale = better quality, especially for icons
        useCORS: true,
        letterRendering: true,
        scrollY: 0,
        scrollX: 0,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
        imageTimeout: 0,
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait',
        compress: true,
      },
      pagebreak: {
        mode: ['avoid-all', 'css', 'legacy'],
        before: '.page-break-before',
        after: '.page-break-after',
        avoid: ['.page-break-avoid', 'h2', 'h3', '.item']
      }
    };

    const mergedOptions = {
      ...defaultOptions,
      ...options,
      html2canvas: { ...defaultOptions.html2canvas, ...(options.html2canvas || {}) },
      jsPDF: { ...defaultOptions.jsPDF, ...(options.jsPDF || {}) },
      pagebreak: { ...defaultOptions.pagebreak, ...(options.pagebreak || {}) }
    };

    try {
      await html2pdf().set(mergedOptions).from(element).save();
      return true;
    } catch (error) {
      console.error('PDF export failed:', error);
      return false;
    }
  };

  /**
   * Open PDF in new tab instead of downloading
   */
  const exportToPdfNewTab = async (element, filename = 'cv', options = {}) => {
    if (!element) {
      console.error('No element provided for PDF export');
      return;
    }

    const defaultOptions = {
      margin: 0,
      filename: `${filename}.pdf`,
      image: { type: 'jpeg', quality: 1 },
      html2canvas: {
        scale: 3,
        useCORS: true,
        letterRendering: true,
        scrollY: 0,
        scrollX: 0,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
        imageTimeout: 0,
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait',
        compress: true,
      },
      pagebreak: {
        mode: ['avoid-all', 'css', 'legacy'],
        before: '.page-break-before',
        after: '.page-break-after',
        avoid: ['.page-break-avoid', 'h2', 'h3', '.item']
      }
    };

    const mergedOptions = {
      ...defaultOptions,
      ...options,
      html2canvas: { ...defaultOptions.html2canvas, ...(options.html2canvas || {}) },
      jsPDF: { ...defaultOptions.jsPDF, ...(options.jsPDF || {}) },
      pagebreak: { ...defaultOptions.pagebreak, ...(options.pagebreak || {}) }
    };

    try {
      const pdf = await html2pdf().set(mergedOptions).from(element).toPdf().get('pdf');
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Clean up the URL after a delay
      setTimeout(() => URL.revokeObjectURL(url), 100);
      return true;
    } catch (error) {
      console.error('PDF export failed:', error);
      return false;
    }
  };

  return {
    exportToPdf,
    exportToPdfNewTab
  };
}
