import FileBrowser from '@/components/FileBrowser';

export default function ResultPage() {
  return (
    <FileBrowser
      api="results"
      readOnly
      allowDirectoryDownload
      labels={{
        select: '请选择结果文件',
        search: '请输入文件名',
        empty: '暂无脚本结果',
      }}
    />
  );
}
