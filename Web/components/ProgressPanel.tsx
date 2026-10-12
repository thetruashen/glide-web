import {formatBytes,type ProgressInfo} from '../lib/progress';
export default function ProgressPanel({value,children}:{value:ProgressInfo;children?:React.ReactNode}){
 const percent=value.percent===undefined?undefined:Math.min(100,Math.max(0,value.percent));
 return <div className="progress-panel" role="status"><div className="progress-heading"><strong>{value.title}</strong><span>{percent===undefined?'In progress':`${Math.floor(percent)}%`}</span></div>{value.detail&&<p>{value.detail}</p>}<progress aria-label={value.title} max={100} value={percent}/><div className="progress-facts">{value.fileCount!==undefined&&<span>File {value.fileIndex || 0} of {value.fileCount}</span>}{value.loaded!==undefined&&<span>{formatBytes(value.loaded)}{value.total?` / ${formatBytes(value.total)}`:''}</span>}{!!value.speed&&<span>{formatBytes(value.speed)}/s</span>}{value.eta!==undefined&&value.eta>1&&<span>About {Math.ceil(value.eta)}s remaining for this file</span>}{children}</div></div>;
}
