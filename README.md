## Sequence Node SDK
Send data into Sequence using this library.

```
yarn add sequence-lib
```

Usage:
```
import SequenceSDK from 'sequence-lib';
const analytics = new SequenceSDK(process.env.SEQUENCE_API_KEY)
analytics.track({
  userId: 'my-user-id',
  event: 'User Registered',
  properties: {
    firstName: 'John',
    lastName: 'Smith'
  }
})
```

### Supported Events
- Identify: https://segment.com/docs/connections/spec/identify/
- Track: https://segment.com/docs/connections/spec/track/