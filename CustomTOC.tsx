import 'react-checkbox-tree/lib/react-checkbox-tree.css';
import CheckboxTree from 'react-checkbox-tree';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import IndeterminateCheckBoxIcon from '@mui/icons-material/IndeterminateCheckBox';

const CustomTOC = ({ checked, nodes, expanded, onExpand, onCheck, id, ...props }) => {
  // Transform nodes to inject subheader as first child if present
  const transformedNodes = nodes.map((node) => {
    if (node.subheader && node.children) {
      return {
        ...node,
        children: [
          {
            label: node.subheader,
            value: `${node.value}_subheader`,
            showCheckbox: false,
            disabled: true,
          },
          ...node.children,
        ],
      };
    }
    return node;
  });

  return (
    <CheckboxTree
      {...props}
      id={id}
      checked={checked}
      nodes={transformedNodes}
      expanded={expanded}
      onExpand={onExpand}
      onCheck={onCheck}
      noCascade={true}
      icons={{
        check: <CheckBoxIcon fontSize="small" className="rct-icon rct-icon-check" />,
        uncheck: (
          <CheckBoxOutlineBlankIcon fontSize="small" className="rct-icon rct-icon-uncheck" />
        ),
        halfCheck: (
          <IndeterminateCheckBoxIcon fontSize="small" className="rct-icon rct-icon-half-check" />
        ),
        expandOpen: <ExpandLessIcon fontSize="small" className="rct-icon rct-icon-expand-close" />,
        expandClose: <ExpandMoreIcon fontSize="small" className="rct-icon rct-icon-expand-close" />,
        expandAll: <span style={{ display: 'none' }} />,
        collapseAll: <span style={{ display: 'none' }} />,
        parentClose: <span style={{ display: 'none' }} />,
        parentOpen: <span style={{ display: 'none' }} />,
        leaf: <span style={{ display: 'none' }} />,
      }}
    />
  );
};

export default CustomTOC;