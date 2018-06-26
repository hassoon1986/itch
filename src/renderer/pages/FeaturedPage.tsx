import urls from "common/constants/urls";
import { Space } from "common/helpers/space";
import { Dispatch } from "common/types";
import React from "react";
import { hook } from "renderer/hocs/hook";
import { withSpace } from "renderer/hocs/withSpace";

class FeaturedPage extends React.PureComponent<Props> {
  render() {
    const { space, dispatch } = this.props;

    dispatch(
      space.makeEvolve({
        replace: true,
        url: urls.itchio,
      })
    );

    return null as JSX.Element;
  }
}

interface Props {
  space: Space;
  dispatch: Dispatch;
}

export default withSpace(hook()(FeaturedPage));